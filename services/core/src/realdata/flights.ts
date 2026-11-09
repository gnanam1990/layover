import { z } from "zod";
import {
  AIRPORTS,
  CARRIER_COUNTRY,
  approxZone,
  regionOf,
  registerAirport,
  type FlightStatus,
} from "@layover/shared";
import type { Clock } from "../clock";
import type { MerchantFlight } from "../merchant/client";
import type { DataBuyer, DataPurchase } from "./buyer";

export const FLIGHTAWARE = "https://stabletravel.dev/api/flightaware/flights";
export const AIRPORT_LOOKUP = "https://api.sitecheck-api.workers.dev/api/airports";

const nstr = z.string().nullish();
const Fa = z.object({
  ident_iata: nstr,
  operator_iata: nstr,
  flight_number: nstr,
  origin: z.object({ code_iata: nstr, code: nstr }).nullish(),
  destination: z.object({ code_iata: nstr, code: nstr }).nullish(),
  scheduled_out: nstr,
  scheduled_in: nstr,
  scheduled_off: nstr,
  scheduled_on: nstr,
  actual_out: nstr,
  actual_off: nstr,
  actual_in: nstr,
  status: nstr,
  cancelled: z.boolean().nullish(),
  departure_delay: z.number().nullish(),
  arrival_delay: z.number().nullish(),
});
export const FaResponse = z.object({ flights: z.array(Fa) });
export const AirportResponse = z.object({
  airports: z.array(
    z.object({ iata: z.string(), name: z.string(), country: z.string(), lat: z.number(), lon: z.number() }),
  ),
});

export function parseFlightId(id: string) {
  const m = /^([A-Z0-9]{2})(\d{1,4})-(\d{4}-\d{2}-\d{2})$/.exec(id);
  return m ? { carrier: m[1]!, number: m[2]!, date: m[3]! } : null;
}

/** FlightAware record → our FlightStatus (delays are seconds in AeroAPI). */
export function toStatus(f: z.infer<typeof Fa>): FlightStatus {
  const depDelayMin = Math.max(0, Math.round((f.departure_delay ?? 0) / 60));
  const arrDelayMin = Math.max(0, Math.round((f.arrival_delay ?? 0) / 60));
  const cancelled = f.cancelled === true || /cancel/i.test(f.status ?? "");
  const state: FlightStatus["state"] = cancelled
    ? "cancelled"
    : f.actual_in
      ? "arrived"
      : f.actual_off || f.actual_out
        ? "departed"
        : depDelayMin >= 15
          ? "delayed"
          : "scheduled";
  return {
    state,
    depDelayMin,
    arrDelayMin,
    noticeAtUtc: null,
    reasonText: f.status ?? null,
    reasonClass: null,
  };
}

/**
 * Real flight status from FlightAware (bought through Kite Passport), cached so polling stays cheap.
 * Real feeds carry no airline notice text, so the rights engine works from the status alone.
 */
export class RealFlights {
  private cache = new Map<string, { at: number; flight: MerchantFlight | null; purchase?: DataPurchase }>();
  constructor(
    private buyer: DataBuyer,
    private clock: Clock,
    private ttlMs = 10 * 60_000,
  ) {}

  lastPurchase(id: string) {
    return this.cache.get(id)?.purchase;
  }

  private async airport(iata: string) {
    if (AIRPORTS[iata]) return;
    const { data } = await this.buyer.get(
      `${AIRPORT_LOOKUP}?code=${encodeURIComponent(iata)}`,
      AirportResponse,
      `Airport ${iata}`,
    );
    const a = data.airports.find((x) => x.iata === iata);
    if (a)
      registerAirport(iata, {
        name: a.name,
        lat: a.lat,
        lon: a.lon,
        country: a.country,
        region: regionOf(a.country),
        tz: approxZone(a.lon),
      });
  }

  async info(id: string): Promise<MerchantFlight | null> {
    const hit = this.cache.get(id);
    if (hit && this.clock.now().getTime() - hit.at < this.ttlMs) return hit.flight;
    const p = parseFlightId(id);
    if (!p) return null;
    const next = new Date(`${p.date}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    const url = `${FLIGHTAWARE}/${p.carrier}${p.number}?ident_type=designator&start=${p.date}T00:00:00Z&end=${next.toISOString().slice(0, 19)}Z&max_pages=1`;
    const { data, purchase } = await this.buyer.get(url, FaResponse, `FlightAware ${p.carrier}${p.number}`);
    const f =
      data.flights.find((x) => (x.scheduled_out ?? x.scheduled_off ?? "").startsWith(p.date)) ??
      data.flights[0];
    const from = f?.origin?.code_iata;
    const to = f?.destination?.code_iata;
    let flight: MerchantFlight | null = null;
    if (f && from && to) {
      await this.airport(from);
      await this.airport(to);
      flight = {
        id,
        carrier: p.carrier,
        number: p.number,
        from,
        to,
        schedDepUtc: f.scheduled_out ?? f.scheduled_off ?? `${p.date}T00:00:00Z`,
        schedArrUtc: f.scheduled_in ?? f.scheduled_on ?? `${p.date}T00:00:00Z`,
        airlineCountry: CARRIER_COUNTRY[p.carrier] ?? "",
        status: toStatus(f),
      };
    }
    this.cache.set(id, { at: this.clock.now().getTime(), flight, purchase });
    return flight;
  }

  async status(id: string): Promise<FlightStatus | null> {
    return (await this.info(id))?.status ?? null;
  }
}
