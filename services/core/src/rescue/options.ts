import { minorOf, type Offer } from "@layover/shared";

/** Deterministic option score (M08 spec): rating×2 − distanceKm×0.3 − priceUSD×0.02. Higher is better. */
export function scoreOffer(o: Offer): number {
  const usd = Number(minorOf(o.price)) / 100;
  return (o.rating ?? 0) * 2 - (o.distanceKm ?? 99) * 0.3 - usd * 0.02;
}

/** Refundable only, best score first (ties: cheaper, then hotelId), top `n`. */
export function rankOptions(offers: Offer[], n = 3): Offer[] {
  return offers
    .filter((o) => o.refundable)
    .map((o) => ({ o, s: scoreOffer(o) }))
    .sort(
      (a, b) =>
        b.s - a.s ||
        Number(minorOf(a.o.price) - minorOf(b.o.price)) ||
        a.o.hotelId.localeCompare(b.o.hotelId),
    )
    .slice(0, n)
    .map((x) => x.o);
}
