import { AIRPORTS, haversineKm } from "@layover/shared";

export function flightDistanceKm(from: string, to: string): number {
  const a = AIRPORTS[from];
  const b = AIRPORTS[to];
  if (!a || !b) throw new Error(`unknown airport ${a ? to : from}`);
  return haversineKm(a, b);
}
