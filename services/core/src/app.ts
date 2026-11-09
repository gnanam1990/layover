import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import {
  Trip,
  TripSettings,
  type Explanation,
  type RightsAssessment,
  type TimelineEvent,
} from "@layover/shared";
import { testConfig, type Config } from "./config";
import { buildServices, type ServiceOverrides, type Services } from "./services";
import { OffsetClock } from "./clock";
import { tripIntake } from "./serv/prompts/tripIntake";
import { assembleTrip } from "./trips/assemble";
import { mailtoLink } from "./claims/pack";
import { FakePassport } from "./passport/fake";
import { PassportError } from "./passport/errors";
import { ServAuthError, ServError } from "./serv/client";
import tripFixture from "../../../packages/shared/fixtures/trip.json";

export interface AppDeps extends Services {
  /** Shared secret for /internal/* and every mutating route (LAYOVER_LOCAL_TOKEN); the web proxy adds it. */
  localToken: string;
}

export type CreateAppOpts = ServiceOverrides & {
  cfg?: Partial<Config>;
  localToken?: string;
  services?: Services;
};

const SimulatedBody = z.object({
  tripId: z.string().default("*"),
  ms: z.number().int().positive().optional(),
});
const IntakeBody = z.object({ text: z.string().min(3).max(8000) });
const ProtectBody = z.object({ settings: TripSettings.partial().optional() });
const RescueConfirmBody = z.object({ offerId: z.string() });
const PriceBody = z.object({
  hotelId: z.string(),
  roomClass: z.string().default("standard"),
  newPrice: z.number().int(),
});
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
});

export function createApp(o: CreateAppOpts = {}) {
  const cfg = { ...testConfig(), ...o.cfg };
  const s: Services = o.services ?? buildServices(cfg, o);
  const localToken = o.localToken ?? cfg.localToken;
  const waiting = new Set<string>();
  const app = new Hono();

  app.onError((err, c) => {
    if (err instanceof z.ZodError)
      return c.json({ error: "bad_request", issues: err.issues.map((i) => i.message) }, 400);
    if (err instanceof PassportError)
      return c.json({ error: err.code, hint: err.hint, userMessage: err.userMessage }, 502);
    if (err instanceof ServAuthError) return c.json({ error: "serv_auth", hint: "Check SERV_API_KEY" }, 502);
    if (err instanceof ServError) return c.json({ error: "serv", hint: err.message }, 502);
    console.error("[core]", err instanceof Error ? err.message : err);
    return c.json({ error: "internal" }, 500);
  });

  // Every mutating route needs the local token (the browser never holds it; the Next.js proxy adds it).
  app.use("*", async (c, next) => {
    if (c.req.method !== "GET" && c.req.method !== "HEAD" && c.req.header("x-layover-token") !== localToken) {
      return c.json({ error: "unauthorized" }, 401);
    }
    await next();
  });

  const demoOnly = (c: { json: (b: unknown, s: 404) => Response }) =>
    s.cfg.demoMode ? null : c.json({ error: "not_found" }, 404);

  // ---------------- health ----------------
  app.get("/health", async (c) => {
    const kp = await s.passport.status().catch(() => ({ loggedIn: false }));
    const merchant = await fetch(`${s.cfg.merchantUrl}/healthz`, { signal: AbortSignal.timeout(1500) })
      .then((r) => r.ok)
      .catch(() => false);
    return c.json({
      ok: true,
      service: "layover-core",
      now: s.clock.now().toISOString(),
      demoClock: s.clock instanceof OffsetClock && s.clock.shifted,
      serv: s.servOffline ? "offline-stub" : "serv",
      payer: s.passport.kind,
      passport: kp,
      merchant: { url: s.cfg.merchantUrl, ok: merchant },
      network: s.cfg.network,
      priceScale: s.cfg.priceScale,
      demoMode: s.cfg.demoMode,
      realData: !!s.buyer,
    });
  });

  // ---------------- internal ----------------
  app.post("/internal/simulated", async (c) => {
    const body = SimulatedBody.parse(await c.req.json().catch(() => ({})));
    s.timeline.markSimulated(body.tripId, body.ms);
    return c.json({ ok: true });
  });

  // ---------------- trips ----------------
  app.post("/trips/intake", async (c) => {
    const { text } = IntakeBody.parse(await c.req.json());
    const draft = await tripIntake(s.serv, text);
    const id = `trip_${crypto.randomUUID().slice(0, 8)}`;
    const r = await assembleTrip(draft, s.merchant, id, s.realHotels);
    return c.json({
      draft,
      ...(r.ok ? { trip: r.trip, missing: [] } : { trip: null, missing: r.missing }),
      serv: s.servOffline ? "offline-stub" : "serv",
    });
  });

  app.post("/trips", async (c) => {
    const { trip } = z.object({ trip: Trip }).parse(await c.req.json());
    s.trips.save(trip);
    s.timeline.append({
      tripId: trip.id,
      type: "trip_added",
      title: `Trip added: ${trip.flights.map((f) => `${f.carrier}${f.number}`).join(", ")}${trip.hotelBookings.length ? ` + ${trip.hotelBookings.map((h) => h.hotelName).join(", ")}` : ""}`,
    });
    return c.json({ trip }, 201);
  });

  app.get("/trips", (c) =>
    c.json(s.trips.list().map((t) => ({ trip: t, session: s.sessions.current(t.id) ?? null }))),
  );

  const latestRights = (tripId: string) => {
    const ev = s.timeline
      .list(tripId)
      .filter((e) => e.type === "rights_assessed")
      .at(-1);
    return ev
      ? (ev.data as { assessment: RightsAssessment; explanation: Explanation & { source?: string } })
      : null;
  };

  app.get("/trips/:id", (c) => {
    const id = c.req.param("id");
    const trip = s.trips.get(id);
    if (!trip) return c.json({ error: "not_found" }, 404);
    const claim = s.claims.latest(id);
    const pendingRescue = s.rescue.pendingFor(id);
    const pendingRebook = [...s.watcher.pending.entries()]
      .filter(([k]) => k.startsWith(`${id}:`))
      .map(([k, offer]) => ({ bookingId: k.split(":")[1], offer }));
    return c.json({
      trip,
      session: s.sessions.current(id) ?? null,
      spent: s.sessions.spentTotal(id),
      rights: latestRights(id),
      claim: claim ? { pack: claim, mailto: mailtoLink(claim.letter) } : null,
      pendingRescue: pendingRescue ? { options: pendingRescue.options } : null,
      pendingRebook,
    });
  });

  app.post("/trips/:id/protect", async (c) => {
    const id = c.req.param("id");
    const { settings } = ProtectBody.parse(await c.req.json().catch(() => ({})));
    if (!s.trips.get(id)) return c.json({ error: "not_found" }, 404);
    if (settings) s.trips.update(id, (t) => ({ ...t, settings: { ...t.settings, ...settings } }));
    const rec = await s.sessions.protectTrip(id);
    if (!waiting.has(id)) {
      waiting.add(id);
      void (async () => {
        try {
          for (let i = 0; i < 6; i++) {
            const r = await s.sessions.waitForApproval(id, 300_000);
            if (r.status !== "requested") break;
          }
        } catch (e) {
          console.error("[core] session wait failed:", (e as Error).message);
        } finally {
          waiting.delete(id);
        }
      })();
    }
    return c.json({ requestId: rec.requestId, approvalUrl: rec.approvalUrl, session: rec });
  });

  app.get("/trips/:id/session", (c) =>
    c.json({
      session: s.sessions.current(c.req.param("id")) ?? null,
      spent: s.sessions.spentTotal(c.req.param("id")),
    }),
  );

  app.post("/trips/:id/rebook/:bookingId/confirm", async (c) => {
    const r = await s.watcher.confirm(c.req.param("id"), c.req.param("bookingId"));
    return c.json(r);
  });

  app.post("/trips/:id/rescue/confirm", async (c) => {
    const { offerId } = RescueConfirmBody.parse(await c.req.json());
    return c.json(await s.rescue.confirm(c.req.param("id"), offerId));
  });

  app.get("/trips/:id/rights", (c) => c.json(latestRights(c.req.param("id"))));

  app.get("/trips/:id/claim", (c) => {
    const pack = s.claims.latest(c.req.param("id"));
    return pack ? c.json({ pack, mailto: mailtoLink(pack.letter) }) : c.json({ error: "not_found" }, 404);
  });

  app.get("/trips/:id/timeline", (c) => c.json(s.timeline.list(c.req.param("id"))));

  // ---------------- live events (SSE, resumable) ----------------
  app.get("/events", (c) => {
    const tripId = c.req.query("tripId") ?? "*";
    const lastId = c.req.header("Last-Event-ID") ?? c.req.query("lastEventId");
    return streamSSE(c, async (stream) => {
      const queue: TimelineEvent[] = [];
      let wake: (() => void) | null = null;
      const unsub = s.timeline.subscribe(tripId, (ev) => {
        queue.push(ev);
        wake?.();
      });
      let closed = false;
      stream.onAbort(() => {
        closed = true;
        unsub();
        wake?.();
      });
      // Replay history first (subscribe happened before, so nothing is lost in between).
      const history = tripId === "*" ? [] : s.timeline.list(tripId, lastId);
      let lastSent = Number(lastId ?? 0);
      for (const ev of history) {
        await stream.writeSSE({ id: ev.id, event: "timeline", data: JSON.stringify(ev) });
        lastSent = Number(ev.id);
      }
      while (!closed) {
        while (queue.length) {
          const ev = queue.shift()!;
          if (Number(ev.id) <= lastSent) continue;
          await stream.writeSSE({ id: ev.id, event: "timeline", data: JSON.stringify(ev) });
          lastSent = Number(ev.id);
        }
        await new Promise<void>((r) => {
          wake = r;
          setTimeout(r, 15_000);
        });
        wake = null;
        if (!queue.length && !closed) await stream.writeSSE({ event: "ping", data: "{}" });
      }
    });
  });

  // ---------------- demo controls (DEMO_MODE=1 only; every effect is labeled Simulated) ----------------
  // Ticks are serialized: a demo button's tick and an explicit /demo/tick never interleave.
  let tickChain: Promise<void> = Promise.resolve();
  type TickKind = "all" | "dropwatch" | "flights";
  const runTick = async (kind: TickKind) => {
    for (const t of s.trips.list()) {
      if (kind !== "flights" && t.status === "protected")
        await s.watcher.tick(t.id).catch((e: Error) => console.error("[dropwatch]", e.message));
      if (kind !== "dropwatch")
        await s.detector.tick(t.id).catch((e: Error) => console.error("[detector]", e.message));
    }
  };
  const tickAll = (kind: TickKind = "all") =>
    (tickChain = tickChain.then(
      () => runTick(kind),
      () => runTick(kind),
    ));

  app.post("/demo/seed", async (c) => {
    const nf = demoOnly(c);
    if (nf) return nf;
    const trip = Trip.parse({ ...(tripFixture as object), status: "draft" });
    if (!s.trips.get(trip.id)) {
      s.trips.save(trip);
      s.timeline.append({
        tripId: trip.id,
        type: "trip_added",
        title: "Trip added: LH761 FRA→BLR + Hotel Lumen Goa",
        simulated: true,
      });
    }
    return c.json({ trip: s.trips.get(trip.id) });
  });

  app.post("/demo/price", async (c) => {
    const nf = demoOnly(c);
    if (nf) return nf;
    const b = PriceBody.parse(await c.req.json());
    s.timeline.markSimulated("*");
    const r = await s.merchant.admin("price", b, s.cfg.adminToken);
    if (!r.ok) return c.json({ error: "merchant_admin_failed", status: r.status }, 502);
    void tickAll();
    return c.json({ ok: true });
  });

  app.post("/demo/flight", async (c) => {
    const nf = demoOnly(c);
    if (nf) return nf;
    const b = FlightBody.parse(await c.req.json());
    s.timeline.markSimulated("*");
    const r = await s.merchant.admin(
      "flight",
      { ...b, noticeAtUtc: s.clock.now().toISOString() },
      s.cfg.adminToken,
    );
    if (!r.ok) return c.json({ error: "merchant_admin_failed", status: r.status }, 502);
    void tickAll();
    return c.json({ ok: true });
  });

  app.post("/demo/reset", async (c) => {
    const nf = demoOnly(c);
    if (nf) return nf;
    await s.merchant.admin("reset", {}, s.cfg.adminToken);
    for (const t of [
      "trips",
      "sessions",
      "payments",
      "refunds",
      "rebooks",
      "rights_assessments",
      "claims",
      "events",
    ]) {
      s.db.exec(`DELETE FROM ${t}`);
    }
    return c.json({ ok: true });
  });

  app.post("/demo/tick", async (c) => {
    const nf = demoOnly(c);
    if (nf) return nf;
    await tickAll();
    return c.json({ ok: true });
  });

  app.post("/demo/time", async (c) => {
    const nf = demoOnly(c);
    if (nf) return nf;
    const { iso } = z.object({ iso: z.string() }).parse(await c.req.json());
    if (!(s.clock instanceof OffsetClock))
      return c.json({ error: "demo clock disabled (set DEMO_NOW)" }, 409);
    s.clock.set(iso);
    return c.json({ now: s.clock.now().toISOString() });
  });

  /** FakePassport only: what the traveler's passkey tap does, for offline demos and UI tests. */
  app.post("/demo/approve", async (c) => {
    const nf = demoOnly(c);
    if (nf) return nf;
    const { tripId } = z.object({ tripId: z.string() }).parse(await c.req.json());
    if (!(s.passport instanceof FakePassport))
      return c.json({ error: "real Kite Passport: approve with your passkey" }, 409);
    const rec = s.sessions.current(tripId);
    if (!rec) return c.json({ error: "no session requested" }, 404);
    s.passport.approve(rec.requestId);
    return c.json({ ok: true });
  });

  app.get("/demo/state", async (c) => {
    const nf = demoOnly(c);
    if (nf) return nf;
    const [goi, fra, lh] = await Promise.all([
      s.merchant.hotelsNear("GOI", "2026-12-22", "2026-12-24").catch(() => []),
      s.merchant.hotelsNear("FRA", "2026-12-20", "2026-12-21").catch(() => []),
      s.merchant.flightStatus("LH761-2026-12-20").catch(() => null),
    ]);
    return c.json({
      hotels: [...goi, ...fra].map((o) => ({
        hotelId: o.hotelId,
        hotelName: o.hotelName,
        roomClass: o.roomClass,
        price: o.price,
      })),
      flights: { "LH761-2026-12-20": lh },
    });
  });

  return Object.assign(app, { services: s, tickAll });
}
