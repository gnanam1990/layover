import type { Flight, HotelBooking, Trip, TripDraft, TripSettings } from "@layover/shared";
import type { MerchantClient } from "../merchant/client";
import { REAL_HOTEL_MERCHANT, type RealHotels } from "../realdata/hotels";

export const DEFAULT_SETTINGS: TripSettings = {
  autoRebook: true,
  minSaving: { amountMinor: "500", currency: "USD" },
  autoRescue: true,
  emergencyBudget: { amountMinor: "15000", currency: "USD" },
  maxPerBooking: { amountMinor: "12000", currency: "USD" },
  maxHotelDistanceKm: 10,
  minRating: 3.5,
};

export type AssembleResult = { ok: true; trip: Trip } | { ok: false; missing: string[] };

/**
 * Turns SERV's TripDraft into a Trip by looking the facts up at the source (flight feed, hotel merchant).
 * The model only extracts identifiers; schedules, prices and policies come from the systems of record.
 */
export async function assembleTrip(
  draft: TripDraft,
  merchant: MerchantClient,
  id: string,
  realHotels?: RealHotels,
): Promise<AssembleResult> {
  const missing = [...draft.missing];
  if (!draft.travelerName && !missing.some((m) => /name/i.test(m)))
    missing.push("What's the traveler's name?");
  const flights: Flight[] = [];
  for (const f of draft.flights) {
    if (!f.carrier || !f.number || !f.date) {
      missing.push("Which flight number and date?");
      continue;
    }
    const fid = `${f.carrier}${f.number}-${f.date}`;
    const info = await merchant.flightInfo(fid);
    if (!info) {
      missing.push(`I couldn't find ${f.carrier}${f.number} on ${f.date}. Check the flight number and date?`);
      continue;
    }
    flights.push({
      id: info.id,
      carrier: info.carrier,
      number: info.number,
      from: info.from as Flight["from"],
      to: info.to as Flight["to"],
      schedDepUtc: info.schedDepUtc,
      schedArrUtc: info.schedArrUtc,
      bookingRef: f.bookingRef,
      airlineCountry: info.airlineCountry,
      status: info.status,
    });
  }
  const hotelBookings: HotelBooking[] = [];
  for (const h of draft.hotels) {
    // Real-data mode: a hotel booked elsewhere needs no Layover confirmation number.
    if (!h.confirmation && !realHotels) {
      missing.push(`What's the confirmation number for ${h.name ?? "your hotel"}?`);
      continue;
    }
    const b = h.confirmation ? await merchant.booking(h.confirmation) : null;
    if (!b && realHotels && h.name && h.checkIn && h.checkOut) {
      // A real hotel booked elsewhere: find it at the live-rates provider and watch it (watch-only).
      if (h.pricePaid === null) {
        missing.push(`How much did you pay in total for ${h.name}?`);
        continue;
      }
      const { hotels } = await realHotels.search(h.name, h.checkIn, h.checkOut);
      const match = hotels[0];
      if (!match) {
        missing.push(`I couldn't find ${h.name} with live rates. Check the hotel name?`);
        continue;
      }
      hotelBookings.push({
        id: `hb_${hotelBookings.length + 1}`,
        merchantId: REAL_HOTEL_MERCHANT,
        hotelId: match.token,
        hotelName: match.name,
        ...(match.rating !== null && { rating: match.rating }),
        checkIn: h.checkIn,
        checkOut: h.checkOut,
        price: { amountMinor: String(Math.round(h.pricePaid * 100)), currency: "USD" },
        refundable: match.freeCancellation ?? false,
        ...(h.confirmation && { confirmation: h.confirmation }),
        paymentTx: null,
        payer: null,
        status: "active",
      });
      continue;
    }
    if (!b) {
      missing.push(`I couldn't find hotel booking ${h.confirmation}. Check the confirmation number?`);
      continue;
    }
    const q = await merchant.quote({
      hotelId: b.hotelId,
      roomClass: b.roomClass,
      checkIn: b.checkIn,
      checkOut: b.checkOut,
    });
    hotelBookings.push({
      id: `hb_${hotelBookings.length + 1}`,
      merchantId: q.merchantId,
      hotelId: b.hotelId,
      hotelName: q.hotelName,
      ...(q.rating !== undefined && { rating: q.rating }),
      roomClass: b.roomClass as HotelBooking["roomClass"],
      checkIn: b.checkIn,
      checkOut: b.checkOut,
      price: { amountMinor: String(b.priceUsd * 100), currency: "USD" },
      refundable: q.refundable,
      ...(q.cancelDeadlineUtc && { cancelDeadlineUtc: q.cancelDeadlineUtc }),
      confirmation: b.confirmation,
      paymentTx: null,
      payer: null,
      status: b.status === "cancelled" ? "cancelled" : "active",
    });
  }
  if (!flights.length && !hotelBookings.length && !missing.length)
    missing.push("Tell me your flight or hotel booking.");
  if (missing.length) return { ok: false, missing: [...new Set(missing)] };
  return {
    ok: true,
    trip: {
      id,
      travelerName: draft.travelerName ?? "Traveler",
      flights,
      hotelBookings,
      settings: DEFAULT_SETTINGS,
      status: "draft",
    },
  };
}
