import type { Airport } from "./schemas";
import { AIRPORTS } from "./rules";

const EU = new Set([
  "AT",
  "BE",
  "BG",
  "HR",
  "CY",
  "CZ",
  "DK",
  "EE",
  "FI",
  "FR",
  "DE",
  "GR",
  "HU",
  "IE",
  "IT",
  "LV",
  "LT",
  "LU",
  "MT",
  "NL",
  "PL",
  "PT",
  "RO",
  "SK",
  "SI",
  "ES",
  "SE",
]);
const EEA = new Set(["IS", "LI", "NO", "CH"]);

/** Country (ISO-2) → the region the rights engine reasons about. */
export function regionOf(country: string): Airport["region"] {
  if (EU.has(country)) return "EU";
  if (EEA.has(country)) return "EEA";
  if (country === "GB") return "UK";
  if (country === "US") return "US";
  if (country === "IN") return "IN";
  return "OTHER";
}

/** Airline IATA code → country of licence (used for EU/UK arrival and DGCA applicability). */
export const CARRIER_COUNTRY: Record<string, string> = {
  LH: "DE",
  EW: "DE",
  DE: "DE",
  AF: "FR",
  KL: "NL",
  IB: "ES",
  VY: "ES",
  AZ: "IT",
  LX: "CH",
  OS: "AT",
  SN: "BE",
  SK: "SE",
  AY: "FI",
  TP: "PT",
  EI: "IE",
  FR: "IE",
  U2: "GB",
  BA: "GB",
  VS: "GB",
  LO: "PL",
  UA: "US",
  AA: "US",
  DL: "US",
  WN: "US",
  B6: "US",
  AS: "US",
  NK: "US",
  F9: "US",
  AI: "IN",
  "6E": "IN",
  UK: "IN",
  SG: "IN",
  IX: "IN",
  QP: "IN",
  EK: "AE",
  EY: "AE",
  QR: "QA",
  SQ: "SG",
  TK: "TR",
  CX: "HK",
  NH: "JP",
  JL: "JP",
  QF: "AU",
  AC: "CA",
};

/**
 * Approximate IANA zone from longitude (Etc/GMT±N). Used only for airports outside the curated table,
 * where the real airport service gives coordinates but no time zone (DECISIONS D12).
 */
export function approxZone(lon: number): string {
  const off = Math.max(-12, Math.min(14, Math.round(lon / 15)));
  if (off === 0) return "Etc/GMT";
  // POSIX sign convention: Etc/GMT-5 means UTC+5.
  return off > 0 ? `Etc/GMT-${off}` : `Etc/GMT+${-off}`;
}

/** Adds an airport learned at runtime (e.g. bought from a real airport-data service). */
export function registerAirport(iata: string, a: Airport) {
  if (!AIRPORTS[iata]) AIRPORTS[iata] = a;
}
