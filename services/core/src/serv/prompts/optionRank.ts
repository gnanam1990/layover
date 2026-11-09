import { OptionWhy, type Offer } from "@layover/shared";
import type { ServClient } from "../client";

export const OPTION_RANK_MODEL = "gpt-5.4-nano";
export const OPTION_RANK_SYSTEM = `You write one short reason (max 16 words) per hotel option explaining why it fits a stranded traveler tonight, using only the provided fields (distance, rating, price, refundability, check-in time). Options are already ranked by code; do not reorder. Output {why: string[]} in the same order.`;

export async function optionRank(serv: ServClient, offers: Offer[], context: string): Promise<string[]> {
  const fields = offers.map((o) => ({
    hotelName: o.hotelName,
    distanceKm: o.distanceKm ?? null,
    rating: o.rating ?? null,
    price: o.price,
    refundable: o.refundable,
    checkIn: o.checkIn,
  }));
  const out = await serv.call("OptionRank", {
    model: OPTION_RANK_MODEL,
    system: OPTION_RANK_SYSTEM,
    user: `Context: ${context}\nOptions (ranked): ${JSON.stringify(fields)}`,
    schema: OptionWhy,
    postCheck: (v) => {
      if (v.why.length !== offers.length)
        throw new Error(`expected ${offers.length} reasons, got ${v.why.length}`);
    },
  });
  return out.why;
}
