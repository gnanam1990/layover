import type { Money } from "./schemas";

/**
 * Money math. Integer minor units only (bigint); never floats.
 * All supported fiat currencies have 2 minor digits.
 */
export const CURRENCIES = ["USD", "EUR", "GBP", "INR"] as const;
export type Currency = (typeof CURRENCIES)[number];

const MINOR_DIGITS = 2;
const SYMBOL: Record<Currency, string> = { USD: "$", EUR: "€", GBP: "£", INR: "₹" };

function assertBigint(v: unknown, name: string): asserts v is bigint {
  if (typeof v !== "bigint") throw new TypeError(`${name} must be a bigint, got ${typeof v}`);
}

export function money(minor: bigint, currency: Currency): Money {
  assertBigint(minor, "minor");
  return { amountMinor: minor.toString(), currency };
}

export function minorOf(m: Money): bigint {
  if (!/^-?\d+$/.test(m.amountMinor)) throw new TypeError(`bad amountMinor ${m.amountMinor}`);
  return BigInt(m.amountMinor);
}

/** "72" | "72.5" | "72.50" → 7200n. Strings only; rejects negatives and > 2 decimals. */
export function toMinor(value: string, _currency: Currency): bigint {
  if (typeof value !== "string") throw new TypeError("toMinor expects a decimal string, not a number");
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!m) throw new RangeError(`invalid money string "${value}"`);
  const whole = BigInt(m[1]!);
  const frac = BigInt((m[2] ?? "").padEnd(MINOR_DIGITS, "0"));
  return whole * 10n ** BigInt(MINOR_DIGITS) + frac;
}

export function fromMinor(minor: bigint, _currency: Currency): string {
  assertBigint(minor, "minor");
  const neg = minor < 0n;
  const abs = neg ? -minor : minor;
  const base = 10n ** BigInt(MINOR_DIGITS);
  const s = `${abs / base}.${(abs % base).toString().padStart(MINOR_DIGITS, "0")}`;
  return neg ? `-${s}` : s;
}

/** Display minor units → settled minor units under the demo price scale (exact division required). */
export function settleMinor(displayMinor: bigint, priceScale: number): bigint {
  assertBigint(displayMinor, "displayMinor");
  if (!Number.isInteger(priceScale) || priceScale < 1)
    throw new RangeError("priceScale must be a positive integer");
  const scale = BigInt(priceScale);
  if (displayMinor % scale !== 0n)
    throw new RangeError(`${displayMinor} not divisible by price scale ${priceScale}`);
  return displayMinor / scale;
}

/** Display minor units (cents) → token atomic units, applying the demo price scale. */
export function toAtomic(displayMinor: bigint, tokenDecimals: number, priceScale: number): bigint {
  assertBigint(displayMinor, "displayMinor");
  if (displayMinor < 0n) throw new RangeError("negative amount");
  if (!Number.isInteger(tokenDecimals) || tokenDecimals < MINOR_DIGITS)
    throw new RangeError("bad token decimals");
  const settled = settleMinor(displayMinor, priceScale);
  return settled * 10n ** BigInt(tokenDecimals - MINOR_DIGITS);
}

/** Token atomic units → display minor units (cents), undoing the demo price scale. */
export function fromAtomic(atomic: bigint, tokenDecimals: number, priceScale: number): bigint {
  assertBigint(atomic, "atomic");
  const unit = 10n ** BigInt(tokenDecimals - MINOR_DIGITS);
  if (atomic % unit !== 0n) throw new RangeError("atomic amount has sub-cent precision");
  return (atomic / unit) * BigInt(priceScale);
}

function same(a: Money, b: Money) {
  if (a.currency !== b.currency) throw new TypeError(`currency mismatch ${a.currency} vs ${b.currency}`);
}
export function add(a: Money, b: Money): Money {
  same(a, b);
  return money(minorOf(a) + minorOf(b), a.currency);
}
export function sub(a: Money, b: Money): Money {
  same(a, b);
  return money(minorOf(a) - minorOf(b), a.currency);
}
export function cmp(a: Money, b: Money): -1 | 0 | 1 {
  same(a, b);
  const x = minorOf(a);
  const y = minorOf(b);
  return x < y ? -1 : x > y ? 1 : 0;
}
/** Percentage in basis points, floored: pct(1400n, 3000) = 420n. */
export function pct(minor: bigint, bps: number): bigint {
  assertBigint(minor, "minor");
  if (!Number.isInteger(bps)) throw new RangeError("bps must be an integer");
  return (minor * BigInt(bps)) / 10000n;
}

export function formatMoney(m: Money): string {
  const s = fromMinor(minorOf(m), m.currency);
  const neg = s.startsWith("-");
  const [whole, frac] = (neg ? s.slice(1) : s).split(".");
  const grouped = whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? "-" : ""}${SYMBOL[m.currency]}${grouped}.${frac}`;
}
