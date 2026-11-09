import { describe, expect, test } from "bun:test";
import { encodeAbiParameters, pad, type Hex } from "viem";
import { TRANSFER_TOPIC, type ReceiptLike } from "../src/chain/verify";
import { BASE_USDC, baseRpc, createBaseVerifier } from "../src/realdata/base-verify";
import { DataBuyer } from "../src/realdata/buyer";
import { FlightStatus } from "@layover/shared";
import type { PassportAdapter } from "../src/passport/adapter";
import { fixedClock } from "./helpers";

const PAYER = "0xc82C2ADE9BbacF01C2168756Ce66E88F69676967";
const PROVIDER = "0xDd257723aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const TX = `0x${"12".repeat(32)}`;

const receipt = (amount: bigint, token = BASE_USDC, from = PAYER): ReceiptLike => ({
  status: "success",
  logs: [
    {
      address: token,
      topics: [TRANSFER_TOPIC, pad(from as Hex), pad(PROVIDER as Hex)] as Hex[],
      data: encodeAbiParameters([{ type: "uint256" }], [amount]),
    },
  ],
});

describe("baseRpc", () => {
  test("Alchemy when ALCHEMY_API_KEY is set, Base public RPC otherwise", () => {
    expect(baseRpc({ ALCHEMY_API_KEY: "k1" })).toEqual({
      url: "https://base-mainnet.g.alchemy.com/v2/k1",
      source: "alchemy",
    });
    expect(baseRpc({})).toEqual({ url: "https://mainnet.base.org", source: "public-rpc" });
  });
});

describe("createBaseVerifier", () => {
  test("exact USDC transfer from the Passport wallet → true; wrong amount/token/payer → false; not mined → null", async () => {
    const v = (r: ReceiptLike | null) => createBaseVerifier({ url: "x", source: "alchemy" }, async () => r);
    expect(await v(receipt(10_000n)).verify(TX, { from: PAYER, amountAtomic: 10_000n })).toBe(true);
    expect(await v(receipt(9_999n)).verify(TX, { from: PAYER, amountAtomic: 10_000n })).toBe(false);
    expect(
      await v(receipt(10_000n, "0x0000000000000000000000000000000000000001")).verify(TX, {
        from: PAYER,
        amountAtomic: 10_000n,
      }),
    ).toBe(false);
    expect(
      await v(receipt(10_000n, BASE_USDC, PROVIDER)).verify(TX, { from: PAYER, amountAtomic: 10_000n }),
    ).toBe(false);
    expect(await v(null).verify(TX, { from: PAYER, amountAtomic: 10_000n })).toBeNull();
    expect(await v(receipt(1n)).verify("0xsim1", { from: PAYER, amountAtomic: 1n })).toBe(false); // not a real hash
  });
});

describe("DataBuyer verification", () => {
  const passport = (amount: string): PassportAdapter => ({
    kind: "passport",
    status: async () => ({ loggedIn: true }),
    walletAddress: async () => PAYER,
    requestSession: async () => ({ requestId: "r", approvalUrl: "x" }),
    awaitSession: async () => ({ status: "timeout" }),
    execute: async () => ({
      status: 200,
      body: { state: "scheduled", depDelayMin: 0, arrDelayMin: 0 },
      payment: { tx: TX, amount, chainId: 8453 },
    }),
  });

  test("a purchase is pending, then verified once the receipt appears", async () => {
    let calls = 0;
    const verifier = createBaseVerifier({ url: "x", source: "alchemy" }, async () =>
      ++calls < 3 ? null : receipt(10_000n),
    );
    const buyer = new DataBuyer(passport("0.01"), fixedClock("2026-11-12T10:00:00Z"), {
      verifier,
      payer: async () => PAYER,
      pollMs: 1,
      sleep: async () => {},
    });
    const { purchase } = await buyer.get("https://stabletravel.dev/x", FlightStatus, "FlightAware UA123");
    expect(buyer.verifierSource).toBe("alchemy");
    await buyer.settled();
    expect(purchase.verified).toBe(true);
    expect(calls).toBe(3);
  });

  test("a receipt that doesn't match the charged amount is flagged false", async () => {
    const verifier = createBaseVerifier({ url: "x", source: "public-rpc" }, async () => receipt(50_000n));
    const buyer = new DataBuyer(passport("0.01"), fixedClock("2026-11-12T10:00:00Z"), {
      verifier,
      payer: async () => PAYER,
      pollMs: 1,
      sleep: async () => {},
    });
    const { purchase } = await buyer.get("https://stabletravel.dev/x", FlightStatus, "FlightAware UA123");
    await buyer.settled();
    expect(purchase.verified).toBe(false);
  });
});
