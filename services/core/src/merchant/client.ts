import { FlightStatus, Offer } from "@layover/shared";
import { z } from "zod";

export interface MerchantClient {
  quote(q: { hotelId: string; roomClass: string; checkIn: string; checkOut: string }): Promise<Offer>;
  hotelsNear(near: string, checkIn: string, checkOut: string): Promise<Offer[]>;
  cancel(
    confirmation: string,
    refundTo?: string,
  ): Promise<
    { ok: true; refundTx: string; amountAtomic?: string } | { ok: false; status: number; error: string }
  >;
  flightStatus(flightId: string): Promise<FlightStatus>;
  flightNotice(flightId: string): Promise<string>;
}

/** Talks to the mock merchant's free routes (catalog, cancel, flight feed). Paid booking goes through Passport. */
export function createMerchantClient(
  baseUrl: string,
  fetchFn: typeof globalThis.fetch = globalThis.fetch,
): MerchantClient {
  const base = baseUrl.replace(/\/$/, "");
  const getJson = async (path: string) => {
    const res = await fetchFn(`${base}${path}`);
    if (!res.ok) throw new Error(`merchant GET ${path} → ${res.status}`);
    return res.json();
  };
  const qs = (o: Record<string, string>) => new URLSearchParams(o).toString();
  return {
    async quote(q) {
      return Offer.parse(await getJson(`/catalog/quote?${qs(q)}`));
    },
    async hotelsNear(near, checkIn, checkOut) {
      return z.array(Offer).parse(await getJson(`/catalog/hotels?${qs({ near, checkIn, checkOut })}`));
    },
    async cancel(confirmation, refundTo) {
      const res = await fetchFn(`${base}/catalog/cancel`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmation, ...(refundTo && { refundTo }) }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        refundTx?: string;
        error?: string;
        amountAtomic?: string;
      };
      if (res.ok && j.refundTx)
        return { ok: true, refundTx: j.refundTx, ...(j.amountAtomic && { amountAtomic: j.amountAtomic }) };
      return { ok: false, status: res.status, error: j.error ?? `HTTP ${res.status}` };
    },
    async flightStatus(flightId) {
      return FlightStatus.parse(await getJson(`/flights/${encodeURIComponent(flightId)}`));
    },
    async flightNotice(flightId) {
      const j = (await getJson(`/flights/${encodeURIComponent(flightId)}/notice`)) as { text?: string };
      return j.text ?? "";
    },
  };
}
