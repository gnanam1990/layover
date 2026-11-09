import { readFileSync, writeFileSync, existsSync } from "node:fs";
import hotelsSeed from "../data/hotels.json";
import flightsSeed from "../data/flights.json";

export interface HotelRow {
  hotelId: string;
  hotelName: string;
  city: string;
  rating: number;
  lat: number;
  lon: number;
  refundable: boolean;
  rooms: Record<string, number>;
}

export interface Booking {
  confirmation: string;
  hotelId: string;
  roomClass: string;
  checkIn: string;
  checkOut: string;
  priceUsd: number;
  refundTo: string | null;
  payer: string | null;
  status: "active" | "cancelled";
  refundTx: string | null;
  createdAt: string;
}

export interface FlightRow {
  id: string;
  carrier: string;
  number: string;
  from: string;
  to: string;
  schedDepUtc: string;
  schedArrUtc: string;
  airlineCountry: string;
  status: {
    state: "scheduled" | "delayed" | "cancelled" | "departed" | "arrived";
    depDelayMin: number;
    arrDelayMin: number;
    noticeAtUtc: string | null;
    reasonText: string | null;
    reasonClass: "weather" | "atc" | "security" | "technical" | "crew" | "strike" | "unknown" | null;
  };
  notice: string | null;
}

interface Snapshot {
  hotels: HotelRow[];
  bookings: Record<string, Booking>;
  flights: Record<string, FlightRow>;
  seq: number;
}

function seed(): Snapshot {
  const hotels = structuredClone(hotelsSeed) as HotelRow[];
  const flights: Record<string, FlightRow> = {};
  for (const f of flightsSeed) {
    flights[f.id] = {
      ...f,
      status: {
        state: "scheduled",
        depDelayMin: 0,
        arrDelayMin: 0,
        noticeAtUtc: null,
        reasonText: null,
        reasonClass: null,
      },
      notice: null,
    };
  }
  // The traveler's original Act 1 booking, made before Layover was watching (paid outside Kite).
  const bookings: Record<string, Booking> = {
    "HX-2231": {
      confirmation: "HX-2231",
      hotelId: "lumen-goa",
      roomClass: "standard",
      checkIn: "2026-12-22",
      checkOut: "2026-12-24",
      priceUsd: 72,
      refundTo: null,
      payer: null,
      status: "active",
      refundTx: null,
      createdAt: "2026-11-01T10:00:00Z",
    },
  };
  return { hotels, bookings, flights, seq: 1000 };
}

/** In-memory world for the demo, optionally persisted to a JSON file (gitignored). */
export class MockState {
  private s: Snapshot;
  constructor(private file?: string) {
    this.s = file && existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Snapshot) : seed();
  }
  private save() {
    if (this.file) writeFileSync(this.file, JSON.stringify(this.s, null, 2));
  }
  reset() {
    this.s = seed();
    this.save();
  }
  hotels(): HotelRow[] {
    return this.s.hotels;
  }
  hotel(id: string): HotelRow | undefined {
    return this.s.hotels.find((h) => h.hotelId === id);
  }
  setPrice(hotelId: string, roomClass: string, usd: number): boolean {
    const h = this.hotel(hotelId);
    if (!h || !(roomClass in h.rooms)) return false;
    h.rooms[roomClass] = usd;
    this.save();
    return true;
  }
  booking(confirmation: string): Booking | undefined {
    return this.s.bookings[confirmation];
  }
  addBooking(b: Omit<Booking, "confirmation" | "status" | "refundTx">): Booking {
    const confirmation = `LX-${++this.s.seq}`;
    const booking: Booking = { ...b, confirmation, status: "active", refundTx: null };
    this.s.bookings[confirmation] = booking;
    this.save();
    return booking;
  }
  updateBooking(confirmation: string, patch: Partial<Booking>) {
    const b = this.s.bookings[confirmation];
    if (b) Object.assign(b, patch);
    this.save();
  }
  flight(id: string): FlightRow | undefined {
    return this.s.flights[id];
  }
  setFlight(id: string, status: Partial<FlightRow["status"]>, notice: string | null) {
    const f = this.s.flights[id];
    if (!f) return false;
    f.status = { ...f.status, ...status };
    f.notice = notice;
    this.save();
    return true;
  }
}
