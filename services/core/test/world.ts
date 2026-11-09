import { createMerchantApp } from "@layover/mocks";
import { MockState } from "@layover/mocks/state";
import { SimulatedFacilitator } from "@layover/mocks/sim-facilitator";
import type { Trip } from "@layover/shared";
import { openDb } from "../src/db";
import { TimelineStore } from "../src/timeline/store";
import { FakePassport } from "../src/passport/fake";
import { SessionManager } from "../src/passport/session-manager";
import { TripRepo } from "../src/trips/repo";
import { createMerchantClient } from "../src/merchant/client";
import { Rebooker } from "../src/dropwatch/rebook";
import { DropWatcher } from "../src/dropwatch/watcher";
import type { ChainVerifier } from "../src/chain/verify";
import { fixedClock } from "./helpers";
import tripFixture from "../../../packages/shared/fixtures/trip.json";

export const ORIGIN = "https://merchant.test";
export const MERCHANT_WALLET = "0x1111111111111111111111111111111111111111";
export const TOKEN = "0x38129cf4CE5E183eFF248F42A7D345Bb1B47621A";
export const ADMIN = "adm1n";

export interface WorldOpts {
  now?: string;
  refundOk?: boolean | (() => boolean);
  refundFails?: boolean;
  settings?: Partial<Trip["settings"]>;
  approve?: boolean;
}

/** A complete in-memory Layover world: mock merchant + core services + FakePassport, no network. */
export async function makeWorld(o: WorldOpts = {}) {
  const facilitator = new SimulatedFacilitator();
  const refunds: { to: string; atomic: bigint }[] = [];
  const state = new MockState();
  const app = createMerchantApp({
    state,
    facilitator,
    network: "testnet",
    payTo: MERCHANT_WALLET,
    priceScale: 100,
    demoMode: true,
    adminToken: ADMIN,
    publicUrl: ORIGIN,
    refundSender: {
      async send(to, atomic) {
        if (o.refundFails) throw new Error("refund rpc down");
        refunds.push({ to, atomic });
        return `0x${"ab".repeat(31)}${String(refunds.length).padStart(2, "0")}`;
      },
    },
  });
  const fetch = ((u: string | URL | Request, i?: RequestInit) =>
    app.request(String(u), i)) as typeof globalThis.fetch;
  const clock = fixedClock(o.now ?? "2026-12-10T10:00:00Z");
  const db = openDb(":memory:");
  const timeline = new TimelineStore(db, clock);
  const passport = new FakePassport({ fetch, clock });
  const trips = new TripRepo(db, clock);
  const base = tripFixture as unknown as Trip;
  const trip: Trip = { ...base, status: "draft", settings: { ...base.settings, ...o.settings } };
  trips.save(trip);
  const sessions = new SessionManager({
    db,
    clock,
    timeline,
    passport,
    trips,
    priceScale: 100,
    merchantUrl: ORIGIN,
  });
  const merchant = createMerchantClient(ORIGIN, fetch);
  const verifyCalls: string[] = [];
  const chain: ChainVerifier = {
    async verifyPayment() {
      return true;
    },
    async verifyRefund(tx) {
      verifyCalls.push(tx);
      const ok = o.refundOk;
      return typeof ok === "function" ? ok() : (ok ?? true);
    },
    explorerTx: (tx) => `https://testnet.kitescan.ai/tx/${tx}`,
  };
  const sleeps: number[] = [];
  const rebooker = new Rebooker({
    db,
    clock,
    timeline,
    trips,
    sessions,
    merchant,
    chain,
    refundTo: async () => passport.wallet,
    merchantWallet: MERCHANT_WALLET,
    token: { address: TOKEN, decimals: 18 },
    priceScale: 100,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock.advance(ms);
    },
  });
  const watcher = new DropWatcher({
    clock,
    timeline,
    trips,
    sessions,
    merchant,
    rebooker,
    allowedOrigins: [ORIGIN],
    priceCheckedThrottleMs: 60_000,
  });
  if (o.approve !== false) {
    const rec = await sessions.protectTrip(trip.id);
    passport.approve(rec.requestId);
    await sessions.waitForApproval(trip.id, 1000);
  }
  const admin = (path: string, body: unknown) =>
    app.request(path, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${ADMIN}` },
      body: JSON.stringify(body),
    });
  const types = () => timeline.list(trip.id).map((e) => e.type);
  return {
    app,
    admin,
    facilitator,
    refunds,
    state,
    fetch,
    clock,
    db,
    timeline,
    passport,
    trips,
    trip,
    sessions,
    merchant,
    chain,
    verifyCalls,
    rebooker,
    watcher,
    sleeps,
    types,
  };
}
