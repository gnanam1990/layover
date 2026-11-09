import { describe, expect, test } from "bun:test";
import { encodeAbiParameters, pad, type Hex } from "viem";
import { explorerTx, verifyRefundInReceipt, TRANSFER_TOPIC } from "../src/chain/verify";

const TOKEN = "0x38129cf4CE5E183eFF248F42A7D345Bb1B47621A" as const;
const MERCHANT = "0x1111111111111111111111111111111111111111" as const;
const WALLET = "0x2222222222222222222222222222222222222222" as const;

function transferLog(token: string, from: string, to: string, amount: bigint) {
  return {
    address: token as Hex,
    topics: [TRANSFER_TOPIC, pad(from as Hex), pad(to as Hex)] as [Hex, Hex, Hex],
    data: encodeAbiParameters([{ type: "uint256" }], [amount]),
  };
}

const AMOUNT = 720000000000000000n;
const receipt = (logs: ReturnType<typeof transferLog>[], status: "success" | "reverted" = "success") => ({
  status,
  logs,
});

describe("verifyRefundInReceipt", () => {
  const exp = { token: TOKEN, from: MERCHANT, to: WALLET, amountAtomic: AMOUNT };
  test("exact Transfer(merchant → wallet, amount) → true", () => {
    expect(verifyRefundInReceipt(receipt([transferLog(TOKEN, MERCHANT, WALLET, AMOUNT)]), exp)).toBe(true);
  });
  test("matches case-insensitively among other logs", () => {
    const logs = [
      transferLog(TOKEN, WALLET, MERCHANT, 5n),
      transferLog(TOKEN.toLowerCase(), MERCHANT.toLowerCase(), WALLET, AMOUNT),
    ];
    expect(verifyRefundInReceipt(receipt(logs), exp)).toBe(true);
  });
  test("wrong amount → false", () => {
    expect(verifyRefundInReceipt(receipt([transferLog(TOKEN, MERCHANT, WALLET, AMOUNT - 1n)]), exp)).toBe(
      false,
    );
  });
  test("wrong recipient → false", () => {
    expect(verifyRefundInReceipt(receipt([transferLog(TOKEN, MERCHANT, MERCHANT, AMOUNT)]), exp)).toBe(false);
  });
  test("wrong token → false", () => {
    const other = "0x7aB6f3ed87C42eF0aDb67Ed95090f8bF5240149e";
    expect(verifyRefundInReceipt(receipt([transferLog(other, MERCHANT, WALLET, AMOUNT)]), exp)).toBe(false);
  });
  test("reverted tx → false", () => {
    expect(
      verifyRefundInReceipt(receipt([transferLog(TOKEN, MERCHANT, WALLET, AMOUNT)], "reverted"), exp),
    ).toBe(false);
  });
});

describe("explorerTx", () => {
  test("mainnet and testnet URLs", () => {
    expect(explorerTx("0xabc", "mainnet")).toBe("https://kitescan.ai/tx/0xabc");
    expect(explorerTx("0xabc", "testnet")).toBe("https://testnet.kitescan.ai/tx/0xabc");
  });
});
