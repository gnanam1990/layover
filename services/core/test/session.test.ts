import { describe, expect, test } from "bun:test";
import { createMerchantApp } from "@layover/mocks";
import { SimulatedFacilitator } from "@layover/mocks/sim-facilitator";
import type { Trip } from "@layover/shared";
import { openDb } from "../src/db";
import { TimelineStore } from "../src/timeline/store";
import { FakePassport } from "../src/passport/fake";
import { SessionManager } from "../src/passport/session-manager";
import { TripRepo } from "../src/trips/repo";
import { fixedClock } from "./helpers";
import tripFixture from "../../../packages/shared/fixtures/trip.json";

const WALLET = "0x2222222222222222222222222222222222222222";
const BOOK = {
  hotelId: "lumen-goa",
  roomClass: "standard",
  checkIn: "2026-12-22",
  checkOut: "2026-12-24",
  refundTo: WALLET,
};

function setup() {
  const facilitator = new SimulatedFacilitator();
  const app = createMerchantApp({ facilitator, publicUrl: "https://merchant.test", priceScale: 100 });
  const fetch = ((u: string | URL | Request, i?: RequestInit) =>
    app.request(String(u), i)) as typeof globalThis.fetch;
  const clock = fixedClock("2026-12-10T10:00:00Z");
  const db = openDb(":memory:");
  const timeline = new TimelineStore(db, clock);
  const passport = new FakePassport({ fetch, clock });
  const trips = new TripRepo(db, clock);
  const trip = { ...(tripFixture as unknown as Trip), status: "draft" as const };
  trips.save(trip);
  const sessions = new SessionManager({
    db,
    clock,
    timeline,
    passport,
    trips,
    priceScale: 100,
    merchantUrl: "https://merchant.test",
  });
  return { sessions, passport, timeline, trips, trip, clock, facilitator };
}

describe("SessionManager.protectTrip", () => {
  test("requests one session with caps from the trip settings (settled at 1:100) and TTL to checkout + 24 h", async () => {
    const { sessions, passport, trip, timeline } = setup();
    const spy: unknown[] = [];
    const orig = passport.requestSession.bind(passport);
    passport.requestSession = async (p) => {
      spy.push(p);
      return orig(p);
    };
    const rec = await sessions.protectTrip(trip.id);
    expect(spy[0]).toMatchObject({ maxPerTx: "1.2", maxTotal: "2.7" }); // $120 and $150 + $120 at 1:100
    // checkout 2026-12-24 + 24 h = 2026-12-25T00:00Z; now 2026-12-10T10:00Z → 14 d 14 h
    expect((spy[0] as { ttlSeconds: number }).ttlSeconds).toBe(14 * 86400 + 14 * 3600);
    expect((spy[0] as { taskSummary: string }).taskSummary).toContain("Layover trip trip_demo");
    expect(rec.status).toBe("requested");
    expect(rec.maxPerTx).toEqual({ amountMinor: "12000", currency: "USD" });
    expect(rec.maxTotal).toEqual({ amountMinor: "27000", currency: "USD" });
    expect(rec.approvalUrl).toContain("approve");
    const ev = timeline.list(trip.id);
    expect(ev.map((e) => e.type)).toEqual(["session_requested"]);
    expect(ev[0]!.links?.[0]?.url).toBe(rec.approvalUrl!);
  });

  test("after passkey approval the session goes active, the trip is Protected and an event fires", async () => {
    const { sessions, passport, trip, timeline, trips } = setup();
    const rec = await sessions.protectTrip(trip.id);
    passport.approve(rec.requestId);
    const active = await sessions.waitForApproval(trip.id, 1000);
    expect(active.status).toBe("active");
    expect(trips.get(trip.id)!.status).toBe("protected");
    expect(timeline.list(trip.id).map((e) => e.type)).toEqual(["session_requested", "session_active"]);
    expect(sessions.current(trip.id)?.status).toBe("active");
  });
});

describe("SessionManager.pay", () => {
  async function active() {
    const s = setup();
    const rec = await s.sessions.protectTrip(s.trip.id);
    s.passport.approve(rec.requestId);
    await s.sessions.waitForApproval(s.trip.id, 1000);
    return s;
  }

  test("pays through the active session and records the payment in display units", async () => {
    const { sessions, trip } = await active();
    const r = await sessions.pay(trip.id, {
      url: "https://merchant.test/v1/book/72",
      body: BOOK,
      idempotencyKey: "trip_demo:hb_1:lumen-goa",
      displayAmountMinor: 7200n,
      bookingId: "hb_1",
    });
    expect(r.status).toBe(200);
    expect(r.payment?.tx).toMatch(/^0xsim/);
    expect(sessions.spentTotalMinor(trip.id)).toBe(7200n);
  });

  test("never retries on the same session after a cap error", async () => {
    const { sessions, passport, trip, timeline } = await active();
    // Session total is $270 display (2.70 settled): $110 + $110 fits, a third $110 does not.
    passport.execute = (
      (orig) => async (p) =>
        orig(p)
    )(passport.execute.bind(passport));
    const pay = (key: string) =>
      sessions.pay(trip.id, {
        url: "https://merchant.test/v1/book/110",
        body: { ...BOOK, hotelId: "main-riverside", checkIn: "2026-12-20", checkOut: "2026-12-21" },
        idempotencyKey: key,
        displayAmountMinor: 11000n,
      });
    await pay("a");
    await pay("b");
    const before = passport.executeCalls;
    const err = await pay("c").catch((e) => e);
    expect(err.code).toBe("session_total_exceeded");
    expect(passport.executeCalls).toBe(before + 1);
    const again = await pay("d").catch((e) => e);
    expect(again.code).toBe("session_total_exceeded");
    expect(passport.executeCalls).toBe(before + 1); // refused locally; Kite not called again
    const errors = timeline.list(trip.id).filter((e) => e.type === "error");
    expect(errors).toHaveLength(1);
    expect(errors[0]!.detail).toContain("Approve a new session");
    expect(sessions.current(trip.id)?.status).toBe("exhausted");
  });

  test("refuses to pay with no active session", async () => {
    const { sessions, trip } = setup();
    const err = await sessions
      .pay(trip.id, {
        url: "https://merchant.test/v1/book/72",
        body: BOOK,
        idempotencyKey: "x",
        displayAmountMinor: 7200n,
      })
      .catch((e) => e);
    expect(err.code).toBe("session_forbidden");
  });
});
