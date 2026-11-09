import { z } from "zod";
import type { Clock } from "../clock";
import type { DataBuyer, DataPurchase } from "./buyer";

export const HOTELS = "https://hotels.use.x402atlas.com";
export const REAL_HOTEL_MERCHANT = "x402atlas";

const Rate = z.object({ extracted_lowest: z.number().nullish() }).nullish();
const Property = z.object({
  name: z.string(),
  property_token: z.string(),
  gps_coordinates: z.object({ latitude: z.number(), longitude: z.number() }).nullish(),
  overall_rating: z.number().nullish(),
  extracted_hotel_class: z.number().nullish(),
  rate_per_night: Rate,
  total_rate: Rate,
  link: z.string().nullish(),
  free_cancellation: z.boolean().nullish(),
});
export const SearchResponse = z.object({ properties: z.array(Property).default([]) });
export const PropertyResponse = z.object({ property: Property });

export interface RealHotel {
  token: string;
  name: string;
  rating: number | null;
  lat: number | null;
  lon: number | null;
  /** Lowest total for the stay in whole USD, as quoted live. */
  totalUsd: number | null;
  nightlyUsd: number | null;
  link: string | null;
  freeCancellation: boolean | null;
}

const toHotel = (p: z.infer<typeof Property>): RealHotel => ({
  token: p.property_token,
  name: p.name,
  rating: p.overall_rating ?? null,
  lat: p.gps_coordinates?.latitude ?? null,
  lon: p.gps_coordinates?.longitude ?? null,
  totalUsd: p.total_rate?.extracted_lowest ?? null,
  nightlyUsd: p.rate_per_night?.extracted_lowest ?? null,
  link: p.link ?? null,
  freeCancellation: p.free_cancellation ?? null,
});

const qs = (o: Record<string, string>) => new URLSearchParams(o).toString();

/** Live hotel rates (bought through Kite Passport). Read-only: these hotels don't take agent payments. */
export class RealHotels {
  private rateCache = new Map<string, { at: number; hotel: RealHotel; purchase: DataPurchase }>();
  constructor(
    private buyer: DataBuyer,
    private clock: Clock,
    private ttlMs = 60 * 60_000,
  ) {}

  async search(
    query: string,
    checkIn: string,
    checkOut: string,
  ): Promise<{ hotels: RealHotel[]; purchase: DataPurchase }> {
    const url = `${HOTELS}/search?${qs({ query, check_in_date: checkIn, check_out_date: checkOut, adults: "2", currency: "USD" })}`;
    const { data, purchase } = await this.buyer.get(url, SearchResponse, "Live hotel search");
    return { hotels: data.properties.map(toHotel), purchase };
  }

  /** Live rate for one property; cached for ttlMs to keep watching cheap. */
  async rate(
    token: string,
    checkIn: string,
    checkOut: string,
  ): Promise<{ hotel: RealHotel; purchase: DataPurchase; fresh: boolean }> {
    const key = `${token}|${checkIn}|${checkOut}`;
    const hit = this.rateCache.get(key);
    if (hit && this.clock.now().getTime() - hit.at < this.ttlMs) return { ...hit, fresh: false };
    const url = `${HOTELS}/property?${qs({ property_token: token, check_in_date: checkIn, check_out_date: checkOut, adults: "2", currency: "USD" })}`;
    const { data, purchase } = await this.buyer.get(url, PropertyResponse, "Live hotel rate");
    const hotel = toHotel(data.property);
    this.rateCache.set(key, { at: this.clock.now().getTime(), hotel, purchase });
    return { hotel, purchase, fresh: true };
  }
}
