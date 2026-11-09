import { describe, expect, test } from "bun:test";
import type { NoticeFacts, Offer } from "@layover/shared";
import { DisruptionDetector, type DisruptionInfo } from "../src/disruption/detector";
import { RescueOrchestrator } from "../src/rescue/orchestrator";
import { rankOptions, scoreOffer } from "../src/rescue/options";
import { makeWorld, ORIGIN } from "./world";
import { fakeServ } from "./fake-serv";

const FACTS: NoticeFacts = {
  state: "cancelled",
  newDepUtc: null,
  offeredAlternatives: ["LH763 2026-12-21 08:40Z"],
  offeredVoucher: true,
  reasonClass: "technical",
  noticeAtUtc: "2026-12-20T19:55:00Z",
};

async function setup(
  o: Parameters<typeof makeWorld>[0] = {},
  serv = fakeServ({
    NoticeParse: () => FACTS,
    RightsExplain: () => {
      throw new Error("use deterministic");
    },
    OptionRank: (opts) => ({
      why: (JSON.parse(opts.user.split("Options (ranked): ")[1]!) as unknown[]).map(
        () => "Close to the airport.",
      ),
    }),
  }),
) {
  const w = await makeWorld({ now: "2026-12-20T19:50:00Z", ...o });
  const claims: DisruptionInfo[] = [];
  const rescue = new RescueOrchestrator({
    clock: w.clock,
    timeline: w.timeline,
    trips: w.trips,
    sessions: w.sessions,
    merchant: w.merchant,
    serv: serv.serv,
    chain: w.chain,
    allowedOrigins: [ORIGIN],
    refundTo: async () => w.passport.wallet,
    buildClaim: async (info) => {
      claims.push(info);
    },
  });
  const detector = new DisruptionDetector({
    clock: w.clock,
    db: w.db,
    timeline: w.timeline,
    trips: w.trips,
    merchant: w.merchant,
    serv: serv.serv,
    onDisruption: (info) => rescue.handle(info),
  });
  const cancelFlight = async () => {
    await w.admin("/admin/flight", {
      id: "LH761-2026-12-20",
      state: "cancelled",
      reasonClass: "technical",
      noticeText:
        "Your flight LH761 has been cancelled. Rebooked on LH763 2026-12-21 08:40Z or take a voucher.",
      noticeAtUtc: "2026-12-20T19:55:00Z",
    });
    await detector.tick(w.trip.id);
  };
  return { w, rescue, detector, claims, cancelFlight, serv };
}

describe("options", () => {
  const offer = (o: Partial<Offer>): Offer => ({
    merchantId: "m",
    hotelId: "h",
    hotelName: "H",
    rating: 4,
    roomClass: "standard",
    distanceKm: 6,
    checkIn: "2026-12-20",
    checkOut: "2026-12-21",
    price: { amountMinor: "9600", currency: "USD" },
    refundable: true,
    payUrl: `${ORIGIN}/v1/book/96`,
    ...o,
  });
  test("score = rating×2 − km×0.3 − USD×0.02", () => {
    expect(scoreOffer(offer({}))).toBeCloseTo(4.28, 5);
  });
  test("refundable only, best first, top 3", () => {
    const r = rankOptions([
      offer({ hotelId: "a", rating: 4.0 }),
      offer({ hotelId: "b", rating: 4.5 }),
      offer({ hotelId: "c", refundable: false, rating: 5 }),
      offer({ hotelId: "d", rating: 3.0 }),
      offer({ hotelId: "e", rating: 3.5 }),
    ]);
    expect(r.map((o) => o.hotelId)).toEqual(["b", "a", "e"]);
  });
});

describe("Rescue (Act 2)", () => {
  test("cancelled + overnight → voucher warning first, then pays Airport Lodge FRA through the gate, receipt saved", async () => {
    const { w, cancelFlight, claims } = await setup();
    await cancelFlight();
    const types = w.types();
    const vw = types.indexOf("voucher_warning");
    const pay = types.lastIndexOf("payment");
    expect(vw).toBeGreaterThan(-1);
    expect(pay).toBeGreaterThan(vw);
    expect(types.slice(types.indexOf("disruption"))).toEqual([
      "disruption",
      "rights_assessed",
      "voucher_warning",
      "policy_decision",
      "payment",
      "rescue_booked",
    ]);
    const booked = w.timeline.list(w.trip.id).find((e) => e.type === "rescue_booked")!;
    expect(booked.title).toContain("Airport Lodge FRA");
    const receipt = (
      booked.data as { receipt: { amount: { amountMinor: string }; tx: string; explorerUrl: string } }
    ).receipt;
    expect(receipt.amount.amountMinor).toBe("9600");
    expect(receipt.tx).toMatch(/^0xsim/);
    expect(receipt.explorerUrl).toContain("kitescan");
    const hb = w.trips.get(w.trip.id)!.hotelBookings.find((b) => b.hotelId === "airport-lodge-fra")!;
    expect(hb.checkIn).toBe("2026-12-20");
    expect(hb.checkOut).toBe("2026-12-21");
    expect(claims).toHaveLength(1);
  });

  test("the voucher warning text tells the traveler what not to accept", async () => {
    const { w, cancelFlight } = await setup();
    await cancelFlight();
    const vw = w.timeline.list(w.trip.id).find((e) => e.type === "voucher_warning")!;
    expect(vw.title).toMatch(/voucher/i);
    expect(vw.detail).toMatch(/hotel first/i);
  });

  test("autoRescue off → 'confirm hotel' prompt, no payment until confirm", async () => {
    const { w, cancelFlight, rescue } = await setup({ settings: { autoRescue: false } });
    await cancelFlight();
    expect(w.types()).not.toContain("rescue_booked");
    expect(w.facilitator.settleCalls).toBe(0);
    const pending = rescue.pendingFor(w.trip.id);
    expect(pending?.options[0]?.hotelId).toBe("airport-lodge-fra");
    const r = await rescue.confirm(w.trip.id, "airport-lodge-fra");
    expect(r.booked).toBe(true);
    expect(w.types()).toContain("rescue_booked");
    expect(w.facilitator.settleCalls).toBe(1);
  });

  test("gate denies every option → error 'No hotel within your limits' with a new-session suggestion", async () => {
    const { w, cancelFlight } = await setup({
      settings: { maxPerBooking: { amountMinor: "5000", currency: "USD" } },
    });
    await cancelFlight();
    expect(w.facilitator.settleCalls).toBe(0);
    const err = w.timeline
      .list(w.trip.id)
      .filter((e) => e.type === "error")
      .at(-1)!;
    expect(err.title).toBe("No hotel within your limits");
    expect(err.detail).toMatch(/new session/i);
  });

  test("no overnight needed → no hotel, but the claim pack is still built", async () => {
    const serv = fakeServ({
      NoticeParse: () => ({ ...FACTS, offeredAlternatives: ["LH9 2026-12-20T22:30:00Z"] }),
      RightsExplain: () => {
        throw new Error("x");
      },
    });
    const { w, cancelFlight, claims } = await setup({}, serv);
    await cancelFlight();
    expect(w.types()).not.toContain("rescue_booked");
    expect(w.facilitator.settleCalls).toBe(0);
    expect(claims).toHaveLength(1);
  });

  test("OptionRank failure does not block the rescue", async () => {
    const serv = fakeServ({
      NoticeParse: () => FACTS,
      RightsExplain: () => {
        throw new Error("x");
      },
      OptionRank: () => {
        throw new Error("SERV down");
      },
    });
    const { w, cancelFlight } = await setup({}, serv);
    await cancelFlight();
    expect(w.types()).toContain("rescue_booked");
  });
});
