import { formatMoney, type Money } from "@layover/shared";

export const money = (m: Money | undefined | null) => (m ? formatMoney(m) : "—");

export function timeUtc(iso: string) {
  return `${iso.slice(11, 16)}`;
}

export function dateShort(isoDate: string) {
  const d = new Date(`${isoDate.slice(0, 10)}T00:00:00Z`);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

export function dateTime(iso: string) {
  const d = new Date(iso);
  return `${d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })} ${iso.slice(11, 16)} UTC`;
}

export const shortHash = (h: string) => (h.length > 14 ? `${h.slice(0, 8)}…${h.slice(-6)}` : h);

/** "trip budget" sentence used on the Protect screen. */
export function limitsSentence(total: Money, perBooking: Money, untilIso: string) {
  return `Layover can spend up to ${formatMoney(total)} in total, ${formatMoney(perBooking)} per booking, until ${dateTime(untilIso).replace(" UTC", "")} UTC.`;
}
