import { describe, expect, test } from "bun:test";
import { AIRPORTS, type NoticeFacts } from "@layover/shared";
import type { ExecuteRequest, ExecuteResult, PassportAdapter } from "../src/passport/adapter";
import { DataBuyer, DataUnavailableError } from "../src/realdata/buyer";
import { RealFlights, toStatus } from "../src/realdata/flights";
import { RealHotels, REAL_HOTEL_MERCHANT } from "../src/realdata/hotels";
import { withRealFlights } from "../src/merchant/client";
import { assembleTrip } from "../src/trips/assemble";
import { DropWatcher } from "../src/dropwatch/watcher";
import { RescueOrchestrator } from "../src/rescue/orchestrator";
import { DisruptionDetector } from "../src/disruption/detector";
import { makeWorld, ORIGIN } from "./world";
import { fakeServ } from "./fake-serv";
import { fixedClock } from "./helpers";

// Recorded shapes follow each provider's published x402 bazaar example.
const fa = (over: Record<string, unknown> = {}) => ({
  flights: [
    {
      ident_iata: "UA123",
      operator_iata: "UA",
      flight_number: "123",
      origin: { code_iata: "ORD", code: "KORD" },
      destination: { code_iata: "JFK", code: "KJFK" },
      scheduled_out: "2026-11-12T22:00:00Z",
      scheduled_in: "2026-11-13T00:30:00Z",
      status: "Scheduled",
      cancelled: false,
      departure_delay: 0,
      arrival_delay: 0,
      ...over,
    },
  ],
});
const airport = {
  airports: [
    { iata: "ORD", name: "Chicago O'Hare International Airport", country: "US", lat: 41.9786, lon: -87.9048 },
  ],
};
const property = (total: number) => ({
  property: {
    name: "Hotel Adlon Kempinski Berlin",
    property_token: "tok_adlon",
    overall_rating: 4.7,
    gps_coordinates: { latitude: 52.516, longitude: 13.38 },
    total_rate: { extracted_lowest: total },
    rate_per_night: { extracted_lowest: total / 2 },
    link: "https://www.kempinski.com/adlon",
    free_cancellation: true,
  },
});
const search = {
  properties: [
    { ...property(640).property },
    {
      name: "Hilton Chicago O'Hare",
      property_token: "tok_hilton",
      overall_rating: 4.1,
      gps_coordinates: { latitude: 41.981, longitude: -87.905 },
      total_rate: { extracted_lowest: 189 },
      link: "https://hilton.com/ord",
    },
  ],
};

/** Stub Passport: returns recorded provider responses by URL and a Base payment receipt. */
function stubPassport(routes: (url: string) => { status?: number; body: unknown }) {
  const calls: ExecuteRequest[] = [];
  let n = 0;
  const p: PassportAdapter = {
    kind: "passport",
    status: async () => ({ loggedIn: true }),
    walletAddress: async () => "0x2222222222222222222222222222222222222222",
    requestSession: async () => ({ requestId: "r", approvalUrl: "x" }),
    awaitSession: async () => ({ status: "timeout" }),
    async execute(req): Promise<ExecuteResult> {
      calls.push(req);
      const r = routes(req.url);
      return {
        status: r.status ?? 200,
        body: r.body,
        payment: { tx: `0x${String(++n).padStart(64, "a")}`, amount: "0.01", chainId: 8453 },
      };
    },
  };
  return { p, calls };
}

const routes =
  (flight = fa(), total = 600) =>
  (url: string) =>
    url.includes("/flightaware/flights/")
      ? { body: flight }
      : url.includes("/api/airports")
        ? { body: airport }
        : url.includes("/property")
          ? { body: property(total) }
          : url.includes("/search")
            ? { body: search }
            : { status: 404, body: {} };

describe("DataBuyer", () => {
  test("pays from the account allowance (never the trip session) and links the Base receipt", async () => {
    const { p, calls } = stubPassport(routes());
    const buyer = new DataBuyer(p, fixedClock("2026-11-12T10:00:00Z"));
    const flights = new RealFlights(buyer, fixedClock("2026-11-12T10:00:00Z"));
    await flights.info("UA123-2026-11-12");
    expect(calls[0]!.useAllowance).toBe(true);
    expect(calls[0]!.sessionId).toBeUndefined();
    expect(calls[0]!.method).toBe("GET");
    expect(calls[0]!.url).toContain(
      "https://stabletravel.dev/api/flightaware/flights/UA123?ident_type=designator&start=2026-11-12T00:00:00Z",
    );
    expect(buyer.purchases[0]!.explorerUrl).toMatch(/^https:\/\/basescan\.org\/tx\/0x/);
  });

  test("a provider error becomes DataUnavailableError (nothing guessed)", async () => {
    const { p } = stubPassport(() => ({ status: 503, body: {} }));
    const buyer = new DataBuyer(p, fixedClock("2026-11-12T10:00:00Z"));
    await expect(
      new RealHotels(buyer, fixedClock("2026-11-12T10:00:00Z")).rate("t", "2026-12-01", "2026-12-03"),
    ).rejects.toBeInstanceOf(DataUnavailableError);
  });
});

describe("RealFlights", () => {
  test("maps FlightAware (delays in seconds) to our status", () => {
    expect(toStatus(fa().flights[0]!).state).toBe("scheduled");
    expect(toStatus({ ...fa().flights[0]!, cancelled: true }).state).toBe("cancelled");
    const d = toStatus({ ...fa().flights[0]!, departure_delay: 3 * 3600, arrival_delay: 3 * 3600 + 600 });
    expect(d).toMatchObject({ state: "delayed", depDelayMin: 180, arrDelayMin: 190 });
    expect(toStatus({ ...fa().flights[0]!, actual_out: "x" }).state).toBe("departed");
  });

  test("learns unknown airports from the real airport service and caches lookups for the TTL", async () => {
    const clock = fixedClock("2026-11-12T10:00:00Z");
    const { p, calls } = stubPassport(routes());
    const flights = new RealFlights(new DataBuyer(p, clock), clock, 600_000);
    const f = await flights.info("UA123-2026-11-12");
    expect(f).toMatchObject({
      from: "ORD",
      to: "JFK",
      airlineCountry: "US",
      schedDepUtc: "2026-11-12T22:00:00Z",
    });
    expect(AIRPORTS.ORD?.region).toBe("US");
    const n = calls.length;
    await flights.status("UA123-2026-11-12");
    expect(calls.length).toBe(n); // cached
    clock.advance(600_001);
    await flights.status("UA123-2026-11-12");
    expect(calls.length).toBe(n + 1);
  });

  test("the mock feed keeps the demo flights; unknown flights go to the real feed", async () => {
    const w = await makeWorld();
    const { p, calls } = stubPassport(routes());
    const merchant = withRealFlights(w.merchant, new RealFlights(new DataBuyer(p, w.clock), w.clock));
    expect((await merchant.flightStatus("LH761-2026-12-20")).state).toBe("scheduled");
    expect(calls).toHaveLength(0);
    expect((await merchant.flightInfo("UA123-2026-11-12"))?.from).toBe("ORD");
    expect(calls.length).toBeGreaterThan(0);
  });
});

describe("real hotels (watch-only)", () => {
  test("intake: a real hotel booked elsewhere is matched by name and needs the price paid", async () => {
    const w = await makeWorld();
    const { p } = stubPassport(routes());
    const real = new RealHotels(new DataBuyer(p, w.clock), w.clock);
    const noPrice = await assembleTrip(
      {
        travelerName: "Ana",
        flights: [],
        hotels: [
          {
            name: "Hotel Adlon",
            checkIn: "2026-12-01",
            checkOut: "2026-12-03",
            confirmation: null,
            pricePaid: null,
          },
        ],
        missing: [],
      },
      w.merchant,
      "t1",
      real,
    );
    expect(noPrice.ok).toBe(false);
    expect(!noPrice.ok && noPrice.missing[0]).toMatch(/How much did you pay/);
    const ok = await assembleTrip(
      {
        travelerName: "Ana",
        flights: [],
        hotels: [
          {
            name: "Hotel Adlon",
            checkIn: "2026-12-01",
            checkOut: "2026-12-03",
            confirmation: null,
            pricePaid: 640,
          },
        ],
        missing: [],
      },
      w.merchant,
      "t1",
      real,
    );
    expect(ok.ok && ok.trip.hotelBookings[0]).toMatchObject({
      merchantId: REAL_HOTEL_MERCHANT,
      hotelId: "tok_adlon",
      price: { amountMinor: "64000" },
    });
  });

  test("a real price drop is announced with the receipt, and Layover never pays or cancels", async () => {
    const w = await makeWorld({ now: "2026-11-12T10:00:00Z" });
    const { p } = stubPassport(routes(fa(), 590));
    const real = new RealHotels(new DataBuyer(p, w.clock), w.clock, 3_600_000);
    w.trips.update(w.trip.id, (t) => ({
      ...t,
      hotelBookings: [
        {
          id: "hb_r",
          merchantId: REAL_HOTEL_MERCHANT,
          hotelId: "tok_adlon",
          hotelName: "Hotel Adlon Kempinski Berlin",
          checkIn: "2026-12-01",
          checkOut: "2026-12-03",
          price: { amountMinor: "64000", currency: "USD" },
          refundable: true,
          status: "active",
        },
      ],
    }));
    const watcher = new DropWatcher({
      clock: w.clock,
      timeline: w.timeline,
      trips: w.trips,
      sessions: w.sessions,
      merchant: w.merchant,
      rebooker: w.rebooker,
      allowedOrigins: [ORIGIN],
      realHotels: real,
    });
    await watcher.tick(w.trip.id);
    const drop = w.timeline.list(w.trip.id).find((e) => e.type === "price_drop")!;
    expect(drop.title).toBe("Hotel Adlon Kempinski Berlin is now $590.00 for your dates (you paid $640.00)");
    expect(drop.detail).toContain("rebook it yourself");
    expect(drop.links?.some((l) => l.url.startsWith("https://basescan.org/tx/"))).toBe(true);
    expect(w.types()).not.toContain("payment");
    expect(w.facilitator.settleCalls).toBe(0);
    await watcher.tick(w.trip.id); // cached: no new purchase, no repeat
    expect(w.types().filter((t) => t === "price_drop")).toHaveLength(1);
  });

  test("no drop (live rate above what you paid) → only a price check", async () => {
    const w = await makeWorld({ now: "2026-11-12T10:00:00Z" });
    const { p } = stubPassport(routes(fa(), 700));
    const watcher = new DropWatcher({
      clock: w.clock,
      timeline: w.timeline,
      trips: w.trips,
      sessions: w.sessions,
      merchant: w.merchant,
      rebooker: w.rebooker,
      allowedOrigins: [ORIGIN],
      realHotels: new RealHotels(new DataBuyer(p, w.clock), w.clock),
    });
    w.trips.update(w.trip.id, (t) => ({
      ...t,
      hotelBookings: [
        {
          id: "hb_r",
          merchantId: REAL_HOTEL_MERCHANT,
          hotelId: "tok_adlon",
          hotelName: "Adlon",
          checkIn: "2026-12-01",
          checkOut: "2026-12-03",
          price: { amountMinor: "64000", currency: "USD" },
          refundable: true,
          status: "active",
        },
      ],
    }));
    await watcher.tick(w.trip.id);
    expect(w.types()).not.toContain("price_drop");
    expect(w.types()).toContain("price_checked");
  });
});

describe("real flight disruption", () => {
  test("a real cancellation at an airport the merchant doesn't cover → rights, live hotel options, claim", async () => {
    const w = await makeWorld({ now: "2026-11-12T20:00:00Z" });
    const { p } = stubPassport(routes(fa({ cancelled: true, status: "Cancelled" })));
    const buyer = new DataBuyer(p, w.clock);
    const realFlights = new RealFlights(buyer, w.clock);
    const realHotels = new RealHotels(buyer, w.clock);
    const merchant = withRealFlights(w.merchant, realFlights);
    w.trips.update(w.trip.id, (t) => ({
      ...t,
      flights: [
        {
          id: "UA123-2026-11-12",
          carrier: "UA",
          number: "123",
          from: "ORD",
          to: "JFK",
          schedDepUtc: "2026-11-12T22:00:00Z",
          schedArrUtc: "2026-11-13T00:30:00Z",
          airlineCountry: "US",
        },
      ],
    }));
    const facts: NoticeFacts = {
      state: "cancelled",
      newDepUtc: null,
      offeredAlternatives: [],
      offeredVoucher: false,
      reasonClass: "unknown",
      noticeAtUtc: null,
    };
    const { serv } = fakeServ({
      NoticeParse: () => facts,
      RightsExplain: () => {
        throw new Error("x");
      },
    });
    const claims: string[] = [];
    const rescue = new RescueOrchestrator({
      clock: w.clock,
      timeline: w.timeline,
      trips: w.trips,
      sessions: w.sessions,
      merchant,
      serv,
      chain: w.chain,
      allowedOrigins: [ORIGIN],
      refundTo: async () => w.passport.wallet,
      buildClaim: async (i) => void claims.push(i.tripId),
      realHotels,
    });
    const detector = new DisruptionDetector({
      clock: w.clock,
      db: w.db,
      timeline: w.timeline,
      trips: w.trips,
      merchant,
      serv,
      onDisruption: (i) => rescue.handle(i),
    });
    await detector.tick(w.trip.id);
    const types = w.types();
    expect(types).toContain("disruption");
    expect(types).toContain("voucher_warning"); // US DOT refund applies
    const opts = w.timeline.list(w.trip.id).find((e) => e.type === "rescue_options")!;
    const names = (opts.data as { options: { name: string }[] }).options.map((o) => o.name);
    expect(names).toEqual(["Hilton Chicago O'Hare"]); // the Berlin hotel is 7,000 km away: filtered out
    expect(w.facilitator.settleCalls).toBe(0); // real hotels: shown, never paid
    expect(claims).toEqual([w.trip.id]);
  });
});
