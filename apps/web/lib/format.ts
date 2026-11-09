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

/**
 * What the claim is worth, per currency: compensation (fixed, or "up to") and the care receipts
 * Layover paid. Shown next to the fee so the revenue story is concrete.
 */
export function claimValue(pack: {
  entitlements: { kind: string; amount?: Money; amountUpTo?: Money }[];
  receipts: { amount: Money }[];
}) {
  const sums = new Map<string, { minor: bigint; upTo: boolean }>();
  const seen = new Set<string>();
  for (const e of pack.entitlements) {
    if (e.kind !== "compensation") continue;
    const m = e.amount ?? e.amountUpTo;
    // Packs don't stack for one disruption: count one compensation per currency.
    if (!m || seen.has(m.currency)) continue;
    seen.add(m.currency);
    sums.set(m.currency, { minor: BigInt(m.amountMinor), upTo: !e.amount });
  }
  const compensation = [...sums.entries()].map(
    ([currency, v]) =>
      `${v.upTo ? "up to " : ""}${formatMoney({ amountMinor: v.minor.toString(), currency: currency as Money["currency"] })}`,
  );
  const receipts = pack.receipts.reduce((acc, r) => acc + BigInt(r.amount.amountMinor), 0n);
  const receiptsText =
    receipts > 0n ? formatMoney({ amountMinor: receipts.toString(), currency: "USD" }) : null;
  return { compensation, receiptsText };
}

export function claimValueText(pack: Parameters<typeof claimValue>[0]) {
  const { compensation, receiptsText } = claimValue(pack);
  const parts = [
    ...compensation.map((c) => `${c} compensation`),
    ...(receiptsText ? [`${receiptsText} in receipts`] : []),
  ];
  return parts.length ? `Claim value: ${parts.join(" + ")}` : null;
}
