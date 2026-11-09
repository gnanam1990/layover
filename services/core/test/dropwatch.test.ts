import { describe, expect, test } from "bun:test";
import { makeWorld } from "./world";

const after = (types: string[], first: string) => types.slice(types.indexOf(first));

describe("Dropwatch", () => {
  test("no drop → no action and only a price_checked event", async () => {
    const w = await makeWorld();
    const r = await w.watcher.tick(w.trip.id);
    expect(r[0]!.action).toBe("none");
    expect(after(w.types(), "session_active").slice(1)).toEqual(["price_checked"]);
    expect(w.facilitator.settleCalls).toBe(0);
  });

  test("price_checked is throttled to once a minute", async () => {
    const w = await makeWorld();
    await w.watcher.tick(w.trip.id);
    await w.watcher.tick(w.trip.id);
    w.clock.advance(61_000);
    await w.watcher.tick(w.trip.id);
    expect(w.types().filter((t) => t === "price_checked")).toHaveLength(2);
  });

  test("drop meeting policy → pay new → confirm → cancel old → verify refund, in that order", async () => {
    const w = await makeWorld();
    await w.admin("/admin/price", { hotelId: "lumen-goa", roomClass: "standard", newPrice: 58 });
    const calls: string[] = [];
    const pay = w.sessions.pay.bind(w.sessions);
    w.sessions.pay = async (...a) => {
      calls.push("pay");
      return pay(...a);
    };
    const cancel = w.merchant.cancel.bind(w.merchant);
    w.merchant.cancel = async (...a) => {
      calls.push("cancel");
      return cancel(...a);
    };
    const verify = w.chain.verifyRefund.bind(w.chain);
    w.chain.verifyRefund = async (...a) => {
      calls.push("verify");
      return verify(...a);
    };

    const r = await w.watcher.tick(w.trip.id);
    expect(r[0]!.action).toBe("rebooked");
    expect(r[0]!.outcome?.state).toBe("DONE");
    expect(calls).toEqual(["pay", "cancel", "verify"]);
    expect(after(w.types(), "price_checked")).toEqual([
      "price_checked",
      "price_drop",
      "policy_decision",
      "payment",
      "booking_confirmed",
      "cancel_requested",
      "refund_verified",
    ]);

    const trip = w.trips.get(w.trip.id)!;
    const old = trip.hotelBookings.find((b) => b.confirmation === "HX-2231")!;
    const fresh = trip.hotelBookings.find((b) => b.id !== old.id)!;
    expect(old.status).toBe("replaced");
    expect(fresh.status).toBe("active");
    expect(fresh.price.amountMinor).toBe("5800");
    expect(fresh.paymentTx).toMatch(/^0xsim/);
    // refund of the old $72 at 1:100 in pieUSD atomic units, to the traveler's wallet
    expect(w.refunds).toEqual([{ to: w.passport.wallet, atomic: 720000000000000000n }]);

    const done = w.timeline.list(w.trip.id).find((e) => e.type === "refund_verified")!;
    expect(done.title).toBe("Saved $14.00 · fee $4.20");
    expect(done.detail).toContain("You keep $9.80");
    const payment = w.timeline.list(w.trip.id).find((e) => e.type === "payment")!;
    expect(payment.links?.[0]?.url).toContain("testnet.kitescan.ai/tx/0xsim");
  });

  test("pay fails (PassportError) → old booking stays active, error event, cancel never called", async () => {
    const w = await makeWorld();
    // The gate allows; Kite itself fails:
    await w.admin("/admin/price", { hotelId: "lumen-goa", roomClass: "standard", newPrice: 58 });
    w.passport.execute = async () => {
      const { mapKpassError } = await import("../src/passport/errors");
      throw mapKpassError({ error_code: "provider_unavailable" }, 1);
    };
    let cancelled = 0;
    w.merchant.cancel = async () => {
      cancelled++;
      return { ok: false, status: 500, error: "should not happen" };
    };
    const r = await w.watcher.tick(w.trip.id);
    expect(r[0]!.outcome?.state).toBe("FAILED_PAY");
    expect(cancelled).toBe(0);
    expect(w.types()).toContain("error");
    const trip = w.trips.get(w.trip.id)!;
    expect(trip.hotelBookings).toHaveLength(1);
    expect(trip.hotelBookings[0]!.status).toBe("active");
  });

  test("merchant 409 (price moved) → nothing charged, old booking kept", async () => {
    const w = await makeWorld();
    await w.admin("/admin/price", { hotelId: "lumen-goa", roomClass: "standard", newPrice: 58 });
    // Price moves again between quote and booking:
    const quote = w.merchant.quote.bind(w.merchant);
    w.merchant.quote = async (q) => {
      const o = await quote(q);
      await w.admin("/admin/price", { hotelId: "lumen-goa", roomClass: "standard", newPrice: 64 });
      return o;
    };
    w.merchant.hotelsNear = async () => [];
    const r = await w.watcher.tick(w.trip.id);
    expect(r[0]!.outcome?.state).toBe("FAILED_PAY");
    expect(w.facilitator.settleCalls).toBe(0);
    expect(w.trips.get(w.trip.id)!.hotelBookings).toHaveLength(1);
  });

  test("cancel fails → both bookings kept and the alert names the deadline", async () => {
    const w = await makeWorld({ refundFails: true });
    await w.admin("/admin/price", { hotelId: "lumen-goa", roomClass: "standard", newPrice: 58 });
    const r = await w.watcher.tick(w.trip.id);
    expect(r[0]!.outcome?.state).toBe("FAILED_CANCEL");
    const trip = w.trips.get(w.trip.id)!;
    expect(trip.hotelBookings.filter((b) => b.status === "active")).toHaveLength(2);
    const err = w.timeline
      .list(w.trip.id)
      .filter((e) => e.type === "error")
      .at(-1)!;
    expect(err.detail).toContain("2026-12-21T12:00:00Z");
    expect(err.detail).toContain("manually");
  });

  test("refund not verified within 2 minutes → 'Refund pending', polling continues", async () => {
    let checks = 0;
    const w = await makeWorld({ refundOk: () => ++checks > 30 }); // verifies after ~150 s of 5 s polls
    await w.admin("/admin/price", { hotelId: "lumen-goa", roomClass: "standard", newPrice: 58 });
    const r = await w.watcher.tick(w.trip.id);
    expect(r[0]!.outcome?.state).toBe("DONE");
    const types = w.types();
    expect(types.indexOf("error")).toBeGreaterThan(types.indexOf("cancel_requested"));
    expect(types.indexOf("refund_verified")).toBeGreaterThan(types.indexOf("error"));
    expect(w.timeline.list(w.trip.id).find((e) => e.type === "error")!.title).toBe("Refund pending");
    expect(w.sleeps.every((ms) => ms === 5000)).toBe(true);
  });

  test("idempotency: two drops detected in the same tick → only one booking", async () => {
    const w = await makeWorld();
    await w.admin("/admin/price", { hotelId: "lumen-goa", roomClass: "standard", newPrice: 58 });
    const [a, b] = await Promise.all([w.watcher.tick(w.trip.id), w.watcher.tick(w.trip.id)]);
    const actions = [a[0]!.action, b[0]!.action].sort();
    expect(actions).toEqual(["busy", "rebooked"]);
    expect(w.facilitator.settleCalls).toBe(1);
    await w.watcher.tick(w.trip.id); // old booking is now replaced → not watched; new one is the cheapest
    expect(w.facilitator.settleCalls).toBe(1);
  });

  test("a denied drop is announced once, not every tick", async () => {
    const w = await makeWorld({ settings: { minSaving: { amountMinor: "2000", currency: "USD" } } });
    await w.admin("/admin/price", { hotelId: "lumen-goa", roomClass: "standard", newPrice: 58 });
    await w.watcher.tick(w.trip.id);
    await w.watcher.tick(w.trip.id);
    expect(w.types().filter((t) => t === "price_drop")).toHaveLength(1);
    const d = w.timeline.list(w.trip.id).find((e) => e.type === "policy_decision")!;
    expect(d.title).toContain("min_saving");
  });

  test("autoRebook off → waits for the traveler's tap, then rebooks on confirm", async () => {
    const w = await makeWorld({ settings: { autoRebook: false } });
    await w.admin("/admin/price", { hotelId: "lumen-goa", roomClass: "standard", newPrice: 58 });
    const r = await w.watcher.tick(w.trip.id);
    expect(r[0]!.action).toBe("awaiting_confirm");
    expect(w.facilitator.settleCalls).toBe(0);
    const c = await w.watcher.confirm(w.trip.id, r[0]!.bookingId);
    expect(c.outcome?.state).toBe("DONE");
  });

  test("a cheaper nearby hotel within policy is chosen when the booked hotel's price holds", async () => {
    const w = await makeWorld();
    await w.admin("/admin/price", { hotelId: "casa-mar", roomClass: "standard", newPrice: 64 });
    const r = await w.watcher.tick(w.trip.id);
    expect(r[0]!.action).toBe("rebooked");
    const fresh = w.trips.get(w.trip.id)!.hotelBookings.find((b) => b.hotelId === "casa-mar")!;
    expect(fresh.price.amountMinor).toBe("6400");
    // Palm Row ($64) is cheaper-or-equal but 3.9★ < 4.2★, so Casa Mar (4.4★, 1.2 km) wins
  });
});
