import { describe, expect, test } from "bun:test";
import {
  add,
  cmp,
  formatMoney,
  fromAtomic,
  money,
  pct,
  sub,
  toAtomic,
  toMinor,
  fromMinor,
  settleMinor,
} from "../src/money";

describe("toMinor / fromMinor", () => {
  test("parses decimal strings into minor units", () => {
    expect(toMinor("72", "USD")).toBe(7200n);
    expect(toMinor("0.72", "USD")).toBe(72n);
    expect(toMinor("1234.5", "EUR")).toBe(123450n);
    expect(toMinor("10000", "INR")).toBe(1000000n);
  });
  test("rejects floats, negatives and too many decimals", () => {
    // @ts-expect-error numbers are not accepted
    expect(() => toMinor(0.72, "USD")).toThrow();
    expect(() => toMinor("-1", "USD")).toThrow();
    expect(() => toMinor("0.725", "USD")).toThrow();
    expect(() => toMinor("abc", "USD")).toThrow();
  });
  test("fromMinor renders a fixed decimal string", () => {
    expect(fromMinor(7200n, "USD")).toBe("72.00");
    expect(fromMinor(5n, "USD")).toBe("0.05");
  });
});

describe("token atomic units", () => {
  test("USDC.e (6 decimals): $0.72 → 720000", () => {
    expect(toAtomic(72n, 6, 1)).toBe(720000n);
  });
  test("pieUSD (18 decimals): $0.72 → 720000000000000000", () => {
    expect(toAtomic(72n, 18, 1)).toBe(720000000000000000n);
  });
  test("PRICE_SCALE=100: display 7200 cents settles 72 cents", () => {
    expect(settleMinor(7200n, 100)).toBe(72n);
    expect(toAtomic(7200n, 18, 100)).toBe(720000000000000000n);
    expect(fromAtomic(720000000000000000n, 18, 100)).toBe(7200n);
  });
  test("rejects negative and non-integer inputs", () => {
    expect(() => toAtomic(-1n, 6, 1)).toThrow();
    // @ts-expect-error numbers are not accepted
    expect(() => toAtomic(72, 6, 1)).toThrow();
    expect(() => toAtomic(1n, 6, 0)).toThrow();
  });
});

describe("arithmetic", () => {
  const a = money(7200n, "USD");
  const b = money(5800n, "USD");
  test("add / sub / cmp", () => {
    expect(sub(a, b).amountMinor).toBe("1400");
    expect(add(a, b).amountMinor).toBe("13000");
    expect(cmp(a, b)).toBe(1);
    expect(cmp(b, a)).toBe(-1);
    expect(cmp(a, a)).toBe(0);
  });
  test("refuses mixed currencies", () => {
    expect(() => add(a, money(1n, "EUR"))).toThrow();
  });
  test("pct in basis points: 30% of $14 = $4.20", () => {
    expect(pct(1400n, 3000)).toBe(420n);
  });
  test("formatMoney", () => {
    expect(formatMoney(money(7200n, "USD"))).toBe("$72.00");
    expect(formatMoney(money(60000n, "EUR"))).toBe("€600.00");
    expect(formatMoney(money(1000000n, "INR"))).toBe("₹10,000.00");
  });
});
