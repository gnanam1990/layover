import { Hono } from "hono";
import { z } from "zod";
import type { FacilitatorClient } from "@x402/core/server";
import { AIRPORTS, haversineKm, round1, toAtomic, type Offer } from "@layover/shared";
import { NETWORKS, BOOKABLE_TIERS, TIERS, type KiteNetwork } from "./config";
import { createPaywall } from "./paywall";
import { MockState, type HotelRow } from "./state";
import type { RefundSender } from "./refund-sender";
import { SimulatedFacilitator } from "./sim-facilitator";

export interface MerchantDeps {
  state: MockState;
  facilitator: FacilitatorClient;
  refundSender: RefundSender;
  network: KiteNetwork;
  payTo: string;
  priceScale: number;
  demoMode: boolean;
  adminToken: string;
  /** Public HTTPS origin used to build pay URLs (MERCHANT_PUBLIC_URL). */
  publicUrl: string;
  /** Tells core that the next events are demo-triggered (`/internal/simulated`). */
  notifySimulated: (what: "price" | "flight" | "reset") => Promise<void>;
}

const MERCHANT_ID = "mock-hotels";

const BookBody = z.object({
  hotelId: z.string(),
  roomClass: z.string(),
  checkIn: z.iso.date(),
  checkOut: z.iso.date(),
  refundTo: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
});
const CancelBody = z.object({
  confirmation: z.string(),
  refundTo: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/)
    .optional(),
});
const PriceBody = z.object({ hotelId: z.string(), roomClass: z.string(), newPrice: z.number().int() });
const FlightBody = z.object({
  id: z.string(),
  state: z.enum(["scheduled", "delayed", "cancelled", "departed", "arrived"]),
  depDelayMin: z.number().int().default(0),
  arrDelayMin: z.number().int().default(0),
  reasonClass: z
    .enum(["weather", "atc", "security", "technical", "crew", "strike", "unknown"])
    .nullable()
    .default(null),
  noticeText: z.string().nullable().default(null),
  noticeAtUtc: z.string().nullable().optional(),
});

function cancelDeadline(checkIn: string) {
  const d = new Date(`${checkIn}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString();
}

export function createMerchantApp(over: Partial<MerchantDeps> = {}) {
  const deps: MerchantDeps = {
    state: new MockState(),
    facilitator: new SimulatedFacilitator(),
    refundSender: { send: async () => "0xunconfigured" },
    network: "testnet",
    payTo: "0x0000000000000000000000000000000000000001",
    priceScale: 100,
    demoMode: false,
    adminToken: "change-me",
    publicUrl: "http://localhost:8601",
    notifySimulated: async () => {},
    ...over,
  };
  const net = NETWORKS[deps.network];
  const base = deps.publicUrl.replace(/\/$/, "");
  const app = new Hono();

  const offer = (
    h: HotelRow,
    roomClass: string,
    checkIn: string,
    checkOut: string,
    from?: { lat: number; lon: number },
  ): Offer => {
    const tier = h.rooms[roomClass]!;
    return {
      merchantId: MERCHANT_ID,
      hotelId: h.hotelId,
      hotelName: h.hotelName,
      rating: h.rating,
      roomClass,
      distanceKm: from ? round1(haversineKm(from, h)) : null,
      checkIn,
      checkOut,
      price: { amountMinor: String(tier * 100), currency: "USD" },
      refundable: h.refundable,
      cancelDeadlineUtc: cancelDeadline(checkIn),
      payUrl: `${base}/v1/book/${tier}`,
      rateTier: tier,
    };
  };

  app.get("/healthz", (c) => c.json({ ok: true, service: "layover-merchant", network: net.caip2 }));
  app.get("/.well-known/x402", (c) =>
    c.json({
      version: 2,
      network: net.caip2,
      payTo: deps.payTo,
      resources: TIERS.map((t) => `${base}/v1/book/${t}`),
    }),
  );

  // ---- free catalog ----
  app.get("/catalog/hotels", (c) => {
    const near = c.req.query("near") ?? "";
    const checkIn = c.req.query("checkIn") ?? "";
    const checkOut = c.req.query("checkOut") ?? "";
    const airport = AIRPORTS[near];
    const refHotel = deps.state.hotel(near);
    const from = airport ?? refHotel;
    if (!from) return c.json({ error: "unknown_location" }, 404);
    const city = airport ? near : refHotel!.city;
    const offers = deps.state
      .hotels()
      .filter((h) => h.city === city)
      .flatMap((h) => Object.keys(h.rooms).map((rc) => offer(h, rc, checkIn, checkOut, from)));
    return c.json(offers);
  });

  app.get("/catalog/quote", (c) => {
    const h = deps.state.hotel(c.req.query("hotelId") ?? "");
    const rc = c.req.query("roomClass") ?? "";
    if (!h || !(rc in h.rooms)) return c.json({ error: "not_found" }, 404);
    return c.json(offer(h, rc, c.req.query("checkIn") ?? "", c.req.query("checkOut") ?? ""));
  });

  app.get("/catalog/bookings/:confirmation", (c) => {
    const b = deps.state.booking(c.req.param("confirmation"));
    return b ? c.json(b) : c.json({ error: "not_found" }, 404);
  });

  app.post("/catalog/cancel", async (c) => {
    const parsed = CancelBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "bad_request" }, 400);
    const b = deps.state.booking(parsed.data.confirmation);
    if (!b) return c.json({ error: "not_found" }, 404);
    if (b.status === "cancelled") return c.json({ error: "already_cancelled", refundTx: b.refundTx }, 409);
    // Only a booking with no recorded refund address (made outside Kite) may be given one now.
    const refundTo = b.refundTo ?? parsed.data.refundTo;
    if (!refundTo) return c.json({ error: "refund_to_required" }, 400);
    const atomic = toAtomic(BigInt(b.priceUsd) * 100n, net.decimals, deps.priceScale);
    deps.state.updateBooking(b.confirmation, { status: "cancelled", refundTo });
    try {
      const refundTx = await deps.refundSender.send(refundTo, atomic, b.confirmation);
      deps.state.updateBooking(b.confirmation, { refundTx });
      return c.json({ confirmation: b.confirmation, refundTx, refundTo, amountAtomic: atomic.toString() });
    } catch (e) {
      return c.json(
        { confirmation: b.confirmation, error: "refund_failed", detail: (e as Error).message },
        502,
      );
    }
  });

  // ---- paid booking (x402) ----
  app.use("/v1/book/*", createPaywall(deps));
  app.post("/v1/book/:tier", async (c) => {
    const tier = Number(c.req.param("tier"));
    if (!(TIERS as readonly number[]).includes(tier)) return c.json({ error: "unknown_tier" }, 404);
    const parsed = BookBody.safeParse(await c.req.json().catch(() => null));
    if (tier === 1) {
      // S8/S1 spike route: proves the payment rail, books nothing.
      return c.json({ confirmation: `SPIKE-${Date.now()}`, spike: true });
    }
    if (!parsed.success) return c.json({ error: "bad_request", issues: parsed.error.issues.length }, 400);
    const h = deps.state.hotel(parsed.data.hotelId);
    const current = h?.rooms[parsed.data.roomClass];
    if (!h || current === undefined) return c.json({ error: "not_found" }, 404);
    // A stale tier means the price moved after the quote: refuse, and the paywall will not settle.
    if (current !== tier) return c.json({ error: "price_changed", currentTier: current }, 409);
    const booking = deps.state.addBooking({
      hotelId: h.hotelId,
      roomClass: parsed.data.roomClass,
      checkIn: parsed.data.checkIn,
      checkOut: parsed.data.checkOut,
      priceUsd: tier,
      refundTo: parsed.data.refundTo,
      payer: null,
      createdAt: new Date().toISOString(),
    });
    return c.json({
      confirmation: booking.confirmation,
      hotelId: h.hotelId,
      hotelName: h.hotelName,
      price: { amountMinor: String(tier * 100), currency: "USD" },
      refundTo: booking.refundTo,
      cancelDeadlineUtc: cancelDeadline(booking.checkIn),
    });
  });

  // ---- flight feed ----
  app.get("/flights/:id", (c) => {
    const f = deps.state.flight(c.req.param("id"));
    return f ? c.json(f.status) : c.json({ error: "not_found" }, 404);
  });
  app.get("/flights/:id/info", (c) => {
    const f = deps.state.flight(c.req.param("id"));
    if (!f) return c.json({ error: "not_found" }, 404);
    const { notice: _n, ...rest } = f;
    return c.json(rest);
  });
  app.get("/flights/:id/notice", (c) => {
    const f = deps.state.flight(c.req.param("id"));
    return f ? c.json({ text: f.notice ?? "" }) : c.json({ error: "not_found" }, 404);
  });

  // ---- demo admin (DEMO_MODE=1 and ADMIN_TOKEN only) ----
  app.use("/admin/*", async (c, next) => {
    if (!deps.demoMode) return c.json({ error: "not_found" }, 404);
    const auth = c.req.header("authorization") ?? "";
    if (auth !== `Bearer ${deps.adminToken}`) return c.json({ error: "unauthorized" }, 401);
    await next();
  });
  app.post("/admin/price", async (c) => {
    const p = PriceBody.safeParse(await c.req.json().catch(() => null));
    if (!p.success || !BOOKABLE_TIERS.includes(p.data.newPrice)) return c.json({ error: "bad_price" }, 400);
    if (!deps.state.setPrice(p.data.hotelId, p.data.roomClass, p.data.newPrice))
      return c.json({ error: "not_found" }, 404);
    await deps.notifySimulated("price");
    return c.json({ ok: true });
  });
  app.post("/admin/flight", async (c) => {
    const p = FlightBody.safeParse(await c.req.json().catch(() => null));
    if (!p.success) return c.json({ error: "bad_request" }, 400);
    const { id, noticeText, ...status } = p.data;
    const ok = deps.state.setFlight(
      id,
      { ...status, noticeAtUtc: status.noticeAtUtc ?? new Date().toISOString(), reasonText: noticeText },
      noticeText,
    );
    if (!ok) return c.json({ error: "not_found" }, 404);
    await deps.notifySimulated("flight");
    return c.json({ ok: true });
  });
  app.post("/admin/reset", async (c) => {
    deps.state.reset();
    await deps.notifySimulated("reset");
    return c.json({ ok: true });
  });

  return app;
}
