import { describe, expect, test } from "bun:test";
import { createMerchantApp, type MerchantDeps } from "../src/merchant";
import { MockState } from "../src/state";
import { SimulatedFacilitator } from "../src/sim-facilitator";
import type { RefundSender } from "../src/refund-sender";

const WALLET = "0x2222222222222222222222222222222222222222";
const MERCHANT = "0x1111111111111111111111111111111111111111";
const ADMIN = "adm1n";

function setup(over: Partial<MerchantDeps> = {}) {
  const facilitator = new SimulatedFacilitator();
  const refunds: { to: string; atomic: bigint; key: string }[] = [];
  const refundSender: RefundSender = {
    async send(to, atomic, key) {
      refunds.push({ to, atomic, key });
      return `0xrefund${refunds.length}`;
    },
  };
  const notified: string[] = [];
  const state = new MockState();
  const app = createMerchantApp({
    state,
    facilitator,
    refundSender,
    network: "testnet",
    payTo: MERCHANT,
    priceScale: 100,
    demoMode: true,
    adminToken: ADMIN,
    publicUrl: "https://merchant.test",
    notifySimulated: async (what) => {
      notified.push(what);
    },
    ...over,
  });
  return { app, facilitator, refunds, notified, state };
}

const json = (body: unknown, headers: Record<string, string> = {}) => ({
  method: "POST",
  headers: { "content-type": "application/json", ...headers },
  body: JSON.stringify(body),
});
const admin = (body: unknown) => json(body, { authorization: `Bearer ${ADMIN}` });

const BOOK = {
  hotelId: "lumen-goa",
  roomClass: "standard",
  checkIn: "2026-12-22",
  checkOut: "2026-12-24",
  refundTo: WALLET,
};

function decodeHeader(h: string | null) {
  return JSON.parse(Buffer.from(h!, "base64").toString("utf8"));
}

/** Pay a 402 the way a client would: echo accepts[0] back in a PAYMENT-SIGNATURE header. */
async function paidRequest(app: ReturnType<typeof setup>["app"], path: string, body: unknown) {
  const first = await app.request(path, json(body));
  expect(first.status).toBe(402);
  const required = decodeHeader(first.headers.get("PAYMENT-REQUIRED"));
  const payload = {
    x402Version: required.x402Version,
    resource: required.resource,
    accepted: required.accepts[0],
    payload: { signature: "0xsig", authorization: { from: WALLET } },
  };
  const sig = Buffer.from(JSON.stringify(payload)).toString("base64");
  return app.request(path, json(body, { "PAYMENT-SIGNATURE": sig }));
}

describe("health and discovery", () => {
  test("/healthz and /.well-known/x402 list the paid tiers", async () => {
    const { app } = setup();
    expect((await app.request("/healthz")).status).toBe(200);
    const wk = (await (await app.request("/.well-known/x402")).json()) as { resources: string[] };
    expect(wk.resources).toContain("https://merchant.test/v1/book/72");
  });
});

describe("catalog", () => {
  test("hotels near FRA: ≥ 3 offers within 10 km, with current prices and pay URLs", async () => {
    const { app } = setup();
    const res = await app.request("/catalog/hotels?near=FRA&checkIn=2026-12-20&checkOut=2026-12-21");
    const offers = (await res.json()) as {
      distanceKm: number;
      price: { amountMinor: string };
      payUrl: string;
    }[];
    const within = offers.filter((o) => o.distanceKm <= 10);
    expect(within.length).toBeGreaterThanOrEqual(3);
    const lodge = offers.find((o) => o.payUrl.endsWith("/v1/book/96"));
    expect(lodge).toBeDefined();
    expect(lodge!.price.amountMinor).toBe("9600");
  });

  test("near=<hotelId> measures distance from that hotel", async () => {
    const { app } = setup();
    const offers = (await (
      await app.request("/catalog/hotels?near=lumen-goa&checkIn=2026-12-22&checkOut=2026-12-24")
    ).json()) as { hotelId: string; distanceKm: number }[];
    const casa = offers.find((o) => o.hotelId === "casa-mar")!;
    expect(casa.distanceKm).toBeGreaterThan(1.0);
    expect(casa.distanceKm).toBeLessThan(1.4);
  });

  test("/admin/price changes /catalog/quote", async () => {
    const { app, notified } = setup();
    const q = "/catalog/quote?hotelId=lumen-goa&roomClass=standard&checkIn=2026-12-22&checkOut=2026-12-24";
    expect(((await (await app.request(q)).json()) as { rateTier: number }).rateTier).toBe(72);
    const r = await app.request(
      "/admin/price",
      admin({ hotelId: "lumen-goa", roomClass: "standard", newPrice: 58 }),
    );
    expect(r.status).toBe(200);
    const after = (await (await app.request(q)).json()) as { rateTier: number; payUrl: string };
    expect(after.rateTier).toBe(58);
    expect(after.payUrl).toBe("https://merchant.test/v1/book/58");
    expect(notified).toEqual(["price"]);
  });

  test("admin price must be a known tier", async () => {
    const { app } = setup();
    const r = await app.request(
      "/admin/price",
      admin({ hotelId: "lumen-goa", roomClass: "standard", newPrice: 59 }),
    );
    expect(r.status).toBe(400);
  });
});

describe("paywall", () => {
  test("unpaid /v1/book/72 → 402 with accepts[0] for pieUSD on Kite testnet", async () => {
    const { app } = setup();
    const res = await app.request("/v1/book/72", json(BOOK));
    expect(res.status).toBe(402);
    const req = decodeHeader(res.headers.get("PAYMENT-REQUIRED"));
    const a = req.accepts[0];
    expect(a.network).toBe("eip155:2368");
    expect(a.asset.toLowerCase()).toBe("0x38129cf4ce5e183eff248f42a7d345bb1b47621a");
    expect(a.payTo).toBe(MERCHANT);
    expect(a.amount).toBe("720000000000000000"); // $72 / PRICE_SCALE 100 = 0.72 pieUSD (18 dp)
    expect(a.extra).toMatchObject({ name: "pieUSD", version: "1" });
  });

  test("paid booking at the current tier → 200 with confirmation, settled once", async () => {
    const { app, facilitator } = setup();
    const res = await paidRequest(app, "/v1/book/72", BOOK);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      confirmation: string;
      price: { amountMinor: string };
      refundTo: string;
    };
    expect(body.confirmation).toMatch(/^LX-/);
    expect(body.price.amountMinor).toBe("7200");
    expect(body.refundTo).toBe(WALLET);
    expect(facilitator.settleCalls).toBe(1);
    expect(res.headers.get("PAYMENT-RESPONSE")).toBeTruthy();
  });

  test("stale tier → 409 price_changed and NO settlement", async () => {
    const { app, facilitator } = setup();
    const res = await paidRequest(app, "/v1/book/58", BOOK); // current price is 72
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe("price_changed");
    expect(facilitator.verifyCalls).toBe(1);
    expect(facilitator.settleCalls).toBe(0);
  });

  test("unknown tier → 404", async () => {
    const { app } = setup();
    expect((await app.request("/v1/book/999", json(BOOK))).status).toBe(404);
  });
});

describe("cancel and refund", () => {
  test("cancel triggers the refund sender and returns refundTx; second cancel → 409", async () => {
    const { app, refunds } = setup();
    const booked = (await (await paidRequest(app, "/v1/book/72", BOOK)).json()) as { confirmation: string };
    const r1 = await app.request("/catalog/cancel", json({ confirmation: booked.confirmation }));
    expect(r1.status).toBe(200);
    expect(((await r1.json()) as { refundTx: string }).refundTx).toBe("0xrefund1");
    expect(refunds[0]).toEqual({ to: WALLET, atomic: 720000000000000000n, key: booked.confirmation });
    const r2 = await app.request("/catalog/cancel", json({ confirmation: booked.confirmation }));
    expect(r2.status).toBe(409);
    expect(refunds).toHaveLength(1);
  });

  test("seeded booking HX-2231 accepts a refundTo on cancel", async () => {
    const { app, refunds } = setup();
    const r = await app.request("/catalog/cancel", json({ confirmation: "HX-2231", refundTo: WALLET }));
    expect(r.status).toBe(200);
    expect(refunds[0]!.to).toBe(WALLET);
  });

  test("unknown confirmation → 404", async () => {
    const { app } = setup();
    expect((await app.request("/catalog/cancel", json({ confirmation: "nope" }))).status).toBe(404);
  });
});

describe("flight feed and admin", () => {
  test("admin cancel → status cancelled and notice text returned", async () => {
    const { app, notified } = setup();
    const id = "LH761-2026-12-20";
    expect(((await (await app.request(`/flights/${id}`)).json()) as { state: string }).state).toBe(
      "scheduled",
    );
    const r = await app.request(
      "/admin/flight",
      admin({
        id,
        state: "cancelled",
        depDelayMin: 0,
        arrDelayMin: 0,
        reasonClass: "technical",
        noticeText: "Cancelled.",
      }),
    );
    expect(r.status).toBe(200);
    const st = (await (await app.request(`/flights/${id}`)).json()) as { state: string; reasonClass: string };
    expect(st.state).toBe("cancelled");
    expect(st.reasonClass).toBe("technical");
    expect(((await (await app.request(`/flights/${id}/notice`)).json()) as { text: string }).text).toBe(
      "Cancelled.",
    );
    expect(notified).toEqual(["flight"]);
  });

  test("admin routes require ADMIN_TOKEN", async () => {
    const { app } = setup();
    expect((await app.request("/admin/reset", json({}))).status).toBe(401);
    expect((await app.request("/admin/reset", admin({}))).status).toBe(200);
  });

  test("DEMO_MODE=0 → admin routes 404", async () => {
    const { app } = setup({ demoMode: false });
    expect((await app.request("/admin/reset", admin({}))).status).toBe(404);
  });

  test("reset restores seed prices", async () => {
    const { app } = setup();
    await app.request("/admin/price", admin({ hotelId: "lumen-goa", roomClass: "standard", newPrice: 58 }));
    await app.request("/admin/reset", admin({}));
    const q = "/catalog/quote?hotelId=lumen-goa&roomClass=standard&checkIn=2026-12-22&checkOut=2026-12-24";
    expect(((await (await app.request(q)).json()) as { rateTier: number }).rateTier).toBe(72);
  });
});

describe("refund failure", () => {
  test("a failed refund rolls the cancellation back (booking stays active, retry possible)", async () => {
    const { app } = setup({
      refundSender: {
        async send() {
          throw new Error("rpc down");
        },
      },
    });
    const r = await app.request("/catalog/cancel", json({ confirmation: "HX-2231", refundTo: WALLET }));
    expect(r.status).toBe(502);
    const b = (await (await app.request("/catalog/bookings/HX-2231")).json()) as { status: string };
    expect(b.status).toBe("active");
  });
});
