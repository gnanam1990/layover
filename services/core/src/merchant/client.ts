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
  flightInfo(flightId: string): Promise<MerchantFlight | null>;
  booking(confirmation: string): Promise<MerchantBooking | null>;
  /** Demo admin (DEMO_MODE only): core forwards the panel's buttons so the browser never sees ADMIN_TOKEN. */
  admin(
    path: "price" | "flight" | "reset",
    body: unknown,
    adminToken: string,
  ): Promise<{ ok: boolean; status: number }>;
}

export interface MerchantFlight {
  id: string;
  carrier: string;
  number: string;
  from: string;
  to: string;
  schedDepUtc: string;
  schedArrUtc: string;
  airlineCountry: string;
  status: FlightStatus;
}
export interface MerchantBooking {
  confirmation: string;
  hotelId: string;
  roomClass: string;
  checkIn: string;
  checkOut: string;
  priceUsd: number;
  status: string;
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
    async flightInfo(flightId) {
      const res = await fetchFn(`${base}/flights/${encodeURIComponent(flightId)}/info`);
      return res.ok ? ((await res.json()) as MerchantFlight) : null;
    },
    async booking(confirmation) {
      const res = await fetchFn(`${base}/catalog/bookings/${encodeURIComponent(confirmation)}`);
      return res.ok ? ((await res.json()) as MerchantBooking) : null;
    },
    async admin(path, body, adminToken) {
      const res = await fetchFn(`${base}/admin/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${adminToken}` },
        body: JSON.stringify(body ?? {}),
      });
      return { ok: res.ok, status: res.status };
    },
  };
}

/**
 * Flights the mock feed doesn't know come from the real FlightAware feed (bought via Kite Passport).
 * The mock feed keeps the scripted demo flights; real trips get real status.
 */
export function withRealFlights(
  base: MerchantClient,
  real: { info(id: string): Promise<MerchantFlight | null> },
): MerchantClient {
  return {
    ...base,
    async flightInfo(id) {
      return (await base.flightInfo(id)) ?? (await real.info(id));
    },
    async flightStatus(id) {
      try {
        return await base.flightStatus(id);
      } catch {
        const f = await real.info(id);
        if (!f) throw new Error(`flight ${id} not found`);
        return f.status;
      }
    },
    async flightNotice(id) {
      return base.flightNotice(id).catch(() => "");
    },
  };
}
