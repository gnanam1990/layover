import type {
  ClaimPack,
  Explanation,
  Money,
  Offer,
  RightsAssessment,
  SessionRecord,
  TimelineEvent,
  Trip,
  TripDraft,
  TripSettings,
} from "@layover/shared";

const BASE = "/api/core";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: { error?: string; hint?: string; userMessage?: string },
  ) {
    super(body.hint ?? body.error ?? `HTTP ${status}`);
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { cache: "no-store", ...init });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new ApiError(res.status, body as { error?: string });
  return body;
}
const post = <T>(path: string, body: unknown = {}) =>
  req<T>(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

export interface Health {
  ok: boolean;
  now: string;
  demoClock: boolean;
  serv: "serv" | "offline-stub";
  payer: "passport" | "direct" | "fake";
  passport: {
    loggedIn: boolean;
    email?: string;
    wallet?: string;
    sandbox?: boolean;
    agent?: { id: string; type: string };
  };
  merchant: { url: string; ok: boolean };
  network: "testnet" | "mainnet";
  priceScale: number;
  demoMode: boolean;
}

export interface TripDetail {
  trip: Trip;
  session: SessionRecord | null;
  spent: Money;
  rights: {
    assessment: RightsAssessment;
    explanation: Explanation & { source?: string };
    desk?: { language: string; phrases: { local: string; english: string }[] };
  } | null;
  claim: { pack: ClaimPack; mailto: string | null } | null;
  pendingRescue: { options: Offer[] } | null;
  pendingRebook: { bookingId: string; offer: Offer }[];
}

export const api = {
  health: () => req<Health>("/health"),
  trips: () => req<{ trip: Trip; session: SessionRecord | null }[]>("/trips"),
  trip: (id: string) => req<TripDetail>(`/trips/${id}`),
  timeline: (id: string) => req<TimelineEvent[]>(`/trips/${id}/timeline`),
  claim: (id: string) => req<{ pack: ClaimPack; mailto: string | null }>(`/trips/${id}/claim`),
  intake: (text: string) =>
    post<{ draft: TripDraft; trip: Trip | null; missing: string[]; serv: string }>("/trips/intake", { text }),
  saveTrip: (trip: Trip) => post<{ trip: Trip }>("/trips", { trip }),
  protect: (id: string, settings: Partial<TripSettings>) =>
    post<{ requestId: string; approvalUrl: string; session: SessionRecord }>(`/trips/${id}/protect`, {
      settings,
    }),
  confirmRescue: (id: string, offerId: string) =>
    post<{ booked: boolean; reasons?: string[] }>(`/trips/${id}/rescue/confirm`, { offerId }),
  confirmRebook: (id: string, bookingId: string) => post(`/trips/${id}/rebook/${bookingId}/confirm`),
  demo: {
    seed: () => post<{ trip: Trip }>("/demo/seed"),
    price: (hotelId: string, newPrice: number, roomClass = "standard") =>
      post("/demo/price", { hotelId, roomClass, newPrice }),
    flight: (b: {
      id: string;
      state: string;
      depDelayMin?: number;
      arrDelayMin?: number;
      reasonClass?: string;
      noticeText?: string;
    }) => post("/demo/flight", b),
    reset: () => post("/demo/reset"),
    tick: () => post("/demo/tick"),
    time: (iso: string) => post<{ now: string }>("/demo/time", { iso }),
    approve: (tripId: string) => post("/demo/approve", { tripId }),
    state: () =>
      req<{
        hotels: { hotelId: string; hotelName: string; roomClass: string; price: Money }[];
        flights: Record<string, { state: string; depDelayMin: number } | null>;
      }>("/demo/state"),
  },
};

export const ACT1 = { hotelId: "lumen-goa", newPrice: 58 };
export const ACT2 = {
  id: "LH761-2026-12-20",
  state: "cancelled",
  reasonClass: "technical",
  noticeText:
    "Due to operational reasons your flight LH761 has been cancelled. You have been rebooked on LH763 2026-12-21 08:40Z or may request a voucher.",
};
