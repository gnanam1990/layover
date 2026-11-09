import { describe, expect, test } from "bun:test";
import type { HotelBooking, Offer, TripSettings } from "@layover/shared";
import { gate, type GateInput } from "../src/policy/gate";

const usd = (dollars: number) => ({ amountMinor: String(dollars * 100), currency: "USD" as const });
const ORIGIN = "https://merchant.test";

const settings: TripSettings = {
  autoRebook: true,
  minSaving: usd(5),
  autoRescue: true,
  emergencyBudget: usd(150),
  maxPerBooking: usd(120),
  maxHotelDistanceKm: 10,
  minRating: 3.5,
};

const booking: HotelBooking = {
  id: "hb_1",
  merchantId: "mock-hotels",
  hotelId: "lumen-goa",
  hotelName: "Hotel Lumen Goa",
  rating: 4.2,
  roomClass: "standard",
  checkIn: "2026-12-20",
  checkOut: "2026-12-22",
  price: usd(72),
  refundable: true,
  cancelDeadlineUtc: "2026-12-19T12:00:00Z",
  confirmation: "HX-2231",
  status: "active",
};

const sameHotel = (price: number, over: Partial<Offer> = {}): Offer => ({
  merchantId: "mock-hotels",
  hotelId: "lumen-goa",
  hotelName: "Hotel Lumen Goa",
  rating: 4.2,
  roomClass: "standard",
  checkIn: "2026-12-20",
  checkOut: "2026-12-22",
  price: usd(price),
  refundable: true,
  cancelDeadlineUtc: "2026-12-19T12:00:00Z",
  payUrl: `${ORIGIN}/v1/book/${price}`,
  rateTier: price,
  ...over,
});

const base = (over: Partial<GateInput> = {}): GateInput => ({
  action: "rebook",
  now: new Date("2026-12-18T10:00:00Z"),
  session: { status: "active", ttlUntilUtc: "2026-12-19T10:00:00Z", maxPerTx: usd(120), maxTotal: usd(270) },
  spentTotal: usd(0),
  offer: sameHotel(58),
  settings,
  allowedOrigins: [ORIGIN],
  booking,
  ...over,
});

const rescueOffer: Offer = {
  merchantId: "mock-hotels",
  hotelId: "airport-lodge-fra",
  hotelName: "Airport Lodge FRA",
  rating: 4.0,
  roomClass: "standard",
  distanceKm: 6,
  checkIn: "2026-12-20",
  checkOut: "2026-12-21",
  price: usd(96),
  refundable: true,
  payUrl: `${ORIGIN}/v1/book/96`,
  rateTier: 96,
};
const rescue = (over: Partial<GateInput> = {}): GateInput => ({
  action: "rescue_hotel",
  now: new Date("2026-12-20T20:30:00Z"),
  session: { status: "active", ttlUntilUtc: "2026-12-25T00:00:00Z", maxPerTx: usd(120), maxTotal: usd(270) },
  spentTotal: usd(0),
  offer: rescueOffer,
  settings,
  allowedOrigins: [ORIGIN],
  disruption: { overnightNeeded: true, nightDate: "2026-12-20" },
  ...over,
});

const denies = (input: GateInput, reason: string): void => {
  const d = gate(input);
  expect(d.allow).toBe(false);
  expect(d.reasons).toContain(reason);
};

describe("rebook table (03-TEST-PLAN §M05)", () => {
  test("1 same hotel, same room, $58, saving $14 ≥ $5 → allow", () => {
    const d = gate(base());
    expect(d.allow).toBe(true);
    expect(d.reasons).toEqual([]);
    expect(d.action).toBe("rebook");
  });
  test("2 saving $4 < $5 → min_saving", () => denies(base({ offer: sameHotel(68) }), "min_saving"));
  test("3 different dates → same_dates", () =>
    denies(base({ offer: sameHotel(58, { checkIn: "2026-12-21" }) }), "same_dates"));
  test("4 lower room class → room_class", () =>
    denies(
      base({ booking: { ...booking, roomClass: "superior", price: usd(96) }, offer: sameHotel(58) }),
      "room_class",
    ));
  test("5 other hotel, rating 4.4 ≥ 4.2, 1.2 km → allow", () => {
    const d = gate(
      base({
        offer: sameHotel(64, { hotelId: "casa-mar", hotelName: "Casa Mar", rating: 4.4 }),
        distanceFromBookedKm: 1.2,
      }),
    );
    expect(d.allow).toBe(true);
  });
  test("6 other hotel, rating 3.9 < 4.2 → rating", () =>
    denies(
      base({ offer: sameHotel(64, { hotelId: "palm-row", rating: 3.9 }), distanceFromBookedKm: 0.8 }),
      "rating",
    ));
  test("7 other hotel, 3.5 km → distance", () =>
    denies(
      base({ offer: sameHotel(64, { hotelId: "casa-mar", rating: 4.4 }), distanceFromBookedKm: 3.5 }),
      "distance",
    ));
  test("8 non-refundable offer → refundable", () =>
    denies(base({ offer: sameHotel(58, { refundable: false }) }), "refundable"));
  test("9 now > cancelDeadline − 2 h → cancel_window", () =>
    denies(base({ now: new Date("2026-12-19T10:30:00Z") }), "cancel_window"));
  test("10 amount $130 > maxPerTx → max_per_tx", () => denies(base({ offer: sameHotel(130) }), "max_per_tx"));
  test("11 spent $200 + $80 > $270 → max_total", () => {
    const d = gate(
      base({
        spentTotal: usd(200),
        booking: { ...booking, price: usd(96) },
        offer: sameHotel(80, { hotelId: "casa-mar", rating: 4.4 }),
        distanceFromBookedKm: 1.2,
      }),
    );
    expect(d.allow).toBe(false);
    expect(d.reasons).toEqual(["max_total"]);
  });
  test("12 session expired → session_active", () =>
    denies(
      base({
        now: new Date("2026-12-19T10:00:01Z"),
        booking: { ...booking, cancelDeadlineUtc: "2026-12-20T12:00:00Z" },
      }),
      "session_active",
    ));
  test("12b no session at all → session_active", () =>
    denies(base({ session: undefined }), "session_active"));
  test("13 payUrl origin not allowed → merchant_origin", () =>
    denies(base({ offer: sameHotel(58, { payUrl: "https://evil.test/v1/book/58" }) }), "merchant_origin"));
  test("13b malformed payUrl → merchant_origin", () =>
    denies(base({ offer: sameHotel(58, { payUrl: "not a url" }) }), "merchant_origin"));
  test("14 autoRebook false, no manual confirm → consent", () =>
    denies(base({ settings: { ...settings, autoRebook: false } }), "consent"));
  test("14b autoRebook false with manual confirm → allow", () =>
    expect(gate(base({ settings: { ...settings, autoRebook: false }, manualConfirm: true })).allow).toBe(
      true,
    ));
  test("15 EUR offer vs USD session → currency", () =>
    denies(base({ offer: sameHotel(58, { price: { amountMinor: "5800", currency: "EUR" } }) }), "currency"));
});

describe("rescue table", () => {
  test("R1 overnight, 6 km, 4.0★, refundable, $96 ≤ $120 → allow", () => {
    const d = gate(rescue());
    expect(d.allow).toBe(true);
    expect(d.action).toBe("rescue_hotel");
  });
  test("R2 no overnight needed → overnight", () =>
    denies(rescue({ disruption: { overnightNeeded: false, nightDate: "2026-12-20" } }), "overnight"));
  test("R3 14 km → distance", () =>
    denies(rescue({ offer: { ...rescueOffer, distanceKm: 14 } }), "distance"));
  test("R4 check-in ≠ disruption night → date", () =>
    denies(rescue({ offer: { ...rescueOffer, checkIn: "2026-12-21" } }), "date"));
  test("R5 autoRescue false, no confirm → consent", () =>
    denies(rescue({ settings: { ...settings, autoRescue: false } }), "consent"));
  test("R6 rating below the trip minimum → rating", () =>
    denies(rescue({ offer: { ...rescueOffer, rating: 3.4 } }), "rating"));
  test("R7 above max per booking → max_per_tx", () =>
    denies(rescue({ settings: { ...settings, maxPerBooking: usd(90) } }), "max_per_tx"));
  test("R8 unknown distance → distance", () =>
    denies(rescue({ offer: { ...rescueOffer, distanceKm: null } }), "distance"));
});

describe("properties", () => {
  test("every decision lists all checks, including passing ones, and is deterministic", () => {
    const a = gate(base());
    expect(a.checks.map((c) => c.name)).toEqual([
      "session_active",
      "amount_positive",
      "currency",
      "merchant_origin",
      "max_per_tx",
      "max_total",
      "consent",
      "same_dates",
      "room_class",
      "hotel_quality",
      "refundable",
      "cancel_window",
      "min_saving",
    ]);
    expect(gate(base())).toEqual(a);
    expect(a).toMatchSnapshot();
    expect(gate(rescue())).toMatchSnapshot();
  });

  test("any single failing check ⇒ deny, and only that check fails", () => {
    const mutations: [string, GateInput][] = [
      ["session_active", base({ session: { ...base().session!, status: "expired" } })],
      [
        "amount_positive",
        base({
          offer: sameHotel(0, { payUrl: `${ORIGIN}/v1/book/0` }),
          settings: { ...settings, minSaving: usd(0) },
        }),
      ],
      ["merchant_origin", base({ offer: sameHotel(58, { payUrl: "http://merchant.test/v1/book/58" }) })],
      ["consent", base({ settings: { ...settings, autoRebook: false } })],
      ["same_dates", base({ offer: sameHotel(58, { checkOut: "2026-12-23" }) })],
      ["refundable", base({ offer: sameHotel(58, { refundable: false }) })],
      ["cancel_window", base({ booking: { ...booking, cancelDeadlineUtc: "2026-12-18T11:00:00Z" } })],
      ["min_saving", base({ settings: { ...settings, minSaving: usd(20) } })],
      ["overnight", rescue({ disruption: { overnightNeeded: false, nightDate: "2026-12-20" } })],
      ["distance", rescue({ offer: { ...rescueOffer, distanceKm: 10.1 } })],
      ["rating", rescue({ offer: { ...rescueOffer, rating: 3.49 } })],
      ["date", rescue({ offer: { ...rescueOffer, checkIn: "2026-12-19" } })],
    ];
    for (const [name, input] of mutations) {
      const d = gate(input);
      expect({ name, allow: d.allow, reasons: d.reasons }).toEqual({ name, allow: false, reasons: [name] });
    }
  });

  test("boundaries are inclusive where the spec says ≤ / ≥", () => {
    expect(gate(rescue({ offer: { ...rescueOffer, distanceKm: 10 } })).allow).toBe(true);
    expect(gate(rescue({ offer: { ...rescueOffer, rating: 3.5 } })).allow).toBe(true);
    expect(gate(base({ offer: sameHotel(67) })).allow).toBe(true); // saving exactly $5
    expect(gate(base({ offer: sameHotel(120), booking: { ...booking, price: usd(130) } })).allow).toBe(true);
    expect(gate(base({ now: new Date("2026-12-19T09:59:59Z") })).allow).toBe(true);
    expect(gate(base({ now: new Date("2026-12-19T10:00:00Z") })).reasons).toContain("cancel_window");
  });

  test("missing booking on a rebook is denied, never allowed", () => {
    const d = gate(base({ booking: undefined }));
    expect(d.allow).toBe(false);
  });
});
