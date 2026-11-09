import { describe, expect, test } from "bun:test";
import { createMerchantApp } from "@layover/mocks";
import { MockState } from "@layover/mocks/state";
import { SimulatedFacilitator } from "@layover/mocks/sim-facilitator";
import { createApp } from "../src/app";
import { openDb } from "../src/db";
import { fixedClock } from "./helpers";
import type { ChainVerifier } from "../src/chain/verify";

const TOKEN = "t0k";
const ORIGIN = "https://merchant.test";

function setup(now = "2026-12-20T19:30:00Z") {
  const facilitator = new SimulatedFacilitator();
  const merchant = createMerchantApp({
    state: new MockState(),
    facilitator,
    network: "testnet",
    payTo: "0x1111111111111111111111111111111111111111",
    priceScale: 100,
    demoMode: true,
    adminToken: "adm1n",
    publicUrl: ORIGIN,
    refundSender: { send: async () => `0x${"cd".repeat(32)}` },
  });
  const merchantFetch = ((u: string | URL | Request, i?: RequestInit) =>
    merchant.request(String(u), i)) as typeof fetch;
  const chain: ChainVerifier = {
    verifyPayment: async () => true,
    verifyRefund: async () => true,
    explorerTx: (tx) => `https://testnet.kitescan.ai/tx/${tx}`,
  };
  const clock = fixedClock(now);
  const app = createApp({
    cfg: { merchantUrl: ORIGIN },
    db: openDb(":memory:"),
    clock,
    merchantFetch,
    chain,
    localToken: TOKEN,
  });
  const post = (path: string, body: unknown = {}, token = TOKEN) =>
    app.request(path, {
      method: "POST",
      headers: { "content-type": "application/json", "x-layover-token": token },
      body: JSON.stringify(body),
    });
  const get = async <T>(path: string) => (await (await app.request(path)).json()) as T;
  return { app, post, get, facilitator, clock };
}

describe("core API", () => {
  test("mutating routes need the local token", async () => {
    const { post } = setup();
    expect((await post("/trips/intake", { text: "hello" }, "nope")).status).toBe(401);
  });

  test("intake (offline SERV stub) → draft with facts looked up at the source → save", async () => {
    const { post, get } = setup();
    const r = await post("/trips/intake", {
      text: "I'm Priya. LH761 FRA→BLR Dec 20, hotel booking HX-2231 at Hotel Lumen Goa Dec 22–24",
    });
    const j = (await r.json()) as {
      trip: { flights: { schedDepUtc: string }[]; hotelBookings: { price: { amountMinor: string } }[] };
      missing: string[];
      serv: string;
    };
    expect(j.serv).toBe("offline-stub");
    expect(j.missing).toEqual([]);
    expect(j.trip.flights[0]!.schedDepUtc).toBe("2026-12-20T20:50:00Z"); // from the flight feed, not the model
    expect(j.trip.hotelBookings[0]!.price.amountMinor).toBe("7200"); // from the merchant, not the model
    const saved = await post("/trips", { trip: j.trip });
    expect(saved.status).toBe(201);
    const list = await get<unknown[]>("/trips");
    expect(list).toHaveLength(1);
  });

  test("intake asks one follow-up when something is missing", async () => {
    const { post } = setup();
    const j = (await (await post("/trips/intake", { text: "LH761 FRA→BLR Dec 20" })).json()) as {
      trip: null;
      missing: string[];
    };
    expect(j.trip).toBeNull();
    expect(j.missing.join(" ")).toMatch(/name/i);
  });

  test("Act 1 + Act 2 through the API: protect → approve → drop price → cancel flight → claim", async () => {
    const { post, get, facilitator } = setup();
    const { trip } = (await (await post("/demo/seed")).json()) as { trip: { id: string } };
    const prot = (await (await post(`/trips/${trip.id}/protect`, {})).json()) as { approvalUrl: string };
    expect(prot.approvalUrl).toContain("approve");
    expect((await post("/demo/approve", { tripId: trip.id })).status).toBe(200);
    for (
      let i = 0;
      i < 50 && (await get<{ session: { status: string } }>(`/trips/${trip.id}`)).session.status !== "active";
      i++
    ) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect((await get<{ trip: { status: string } }>(`/trips/${trip.id}`)).trip.status).toBe("protected");

    await post("/demo/price", { hotelId: "lumen-goa", roomClass: "standard", newPrice: 58 });
    await post("/demo/tick");
    let tl = await get<{ type: string; simulated: boolean; title: string }[]>(`/trips/${trip.id}/timeline`);
    expect(tl.map((e) => e.type)).toContain("refund_verified");
    expect(tl.find((e) => e.type === "price_drop")!.simulated).toBe(true);
    expect(tl.find((e) => e.type === "refund_verified")!.title).toBe("Saved $14.00 · fee $4.20");

    await post("/demo/flight", {
      id: "LH761-2026-12-20",
      state: "cancelled",
      reasonClass: "technical",
      noticeText: "LH761 cancelled. Voucher available.",
    });
    await post("/demo/tick");
    tl = await get(`/trips/${trip.id}/timeline`);
    const types = tl.map((e) => e.type);
    expect(types.indexOf("voucher_warning")).toBeLessThan(types.lastIndexOf("payment"));
    expect(types).toContain("rescue_booked");
    expect(types).toContain("claim_ready");
    expect(facilitator.settleCalls).toBe(2);

    const detail = await get<{
      rights: { assessment: { packs: { pack: string }[] } };
      claim: { pack: { receipts: unknown[] }; mailto: string | null };
      spent: { amountMinor: string };
    }>(`/trips/${trip.id}`);
    expect(detail.rights.assessment.packs.map((p) => p.pack)).toEqual(["eu261"]);
    expect(detail.claim.pack.receipts).toHaveLength(1);
    expect(detail.spent.amountMinor).toBe("15400"); // $58 rebook + $96 rescue hotel
    const claim = await get<{ pack: { letter: { body: string } } }>(`/trips/${trip.id}/claim`);
    expect(claim.pack.letter.body).toContain("€600.00");
  });

  test("health reports the payer and SERV mode honestly", async () => {
    const { get } = setup();
    const h = await get<{ serv: string; payer: string; demoMode: boolean }>("/health");
    expect(h).toMatchObject({ serv: "offline-stub", payer: "fake", demoMode: true });
  });

  test("demo routes are 404 when DEMO_MODE is off", async () => {
    const app = createApp({ cfg: { demoMode: false }, db: openDb(":memory:"), localToken: TOKEN });
    const r = await app.request("/demo/seed", { method: "POST", headers: { "x-layover-token": TOKEN } });
    expect(r.status).toBe(404);
  });
});

describe("intake regressions", () => {
  test("a hotel-only trip needs no flight", async () => {
    const { post } = setup();
    const j = (await (
      await post("/trips/intake", { text: "I'm Priya. Hotel Lumen Goa HX-2231 Dec 22–24" })
    ).json()) as { trip: unknown; missing: string[] };
    expect(j.missing).toEqual([]);
    expect(j.trip).not.toBeNull();
  });
});

describe("live demo: original booking paid through Kite", () => {
  test("book-original pays the original hotel, then Act 1 refunds that paid booking", async () => {
    const { post, get, facilitator } = setup();
    const { trip } = (await (await post("/demo/seed")).json()) as { trip: { id: string } };
    await post(`/trips/${trip.id}/protect`, {});
    await post("/demo/approve", { tripId: trip.id });
    for (
      let i = 0;
      i < 50 && (await get<{ trip: { status: string } }>(`/trips/${trip.id}`)).trip.status !== "protected";
      i++
    ) {
      await new Promise((r) => setTimeout(r, 10));
    }
    const r = (await (await post("/demo/book-original", { tripId: trip.id })).json()) as {
      confirmation: string;
      tx: string;
    };
    expect(r.confirmation).toMatch(/^LX-/);
    expect(r.tx).toMatch(/^0xsim/);
    const t = await get<{ trip: { hotelBookings: { confirmation: string; paymentTx: string }[] } }>(
      `/trips/${trip.id}`,
    );
    expect(t.trip.hotelBookings[0]).toMatchObject({ confirmation: r.confirmation, paymentTx: r.tx });
    await post("/demo/price", { hotelId: "lumen-goa", roomClass: "standard", newPrice: 58 });
    await post("/demo/tick");
    const tl = await get<{ type: string; title: string }[]>(`/trips/${trip.id}/timeline`);
    expect(tl.find((e) => e.type === "cancel_requested")!.title).toContain(r.confirmation);
    expect(tl.map((e) => e.type)).toContain("refund_verified");
    expect(facilitator.settleCalls).toBe(2); // original $72 + rebook $58
    expect((await post("/demo/book-original", { tripId: trip.id })).status).toBe(404); // nothing unpaid left
  });
});
