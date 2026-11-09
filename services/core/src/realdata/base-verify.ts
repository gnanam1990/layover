import { createPublicClient, http, type Hex } from "viem";
import { verifyRefundInReceipt, type ReceiptLike } from "../chain/verify";

/** USDC on Base mainnet (the asset the real-data providers settle in). */
export const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
export const BASE_CHAIN_ID = 8453;

export type VerifierSource = "alchemy" | "public-rpc";

export interface PaymentVerifier {
  readonly source: VerifierSource;
  /** true = exact transfer found, false = receipt says otherwise, null = not mined / not found yet. */
  verify(tx: string, exp: { from: string; amountAtomic: bigint }): Promise<boolean | null>;
}

/** Alchemy's Base endpoint when ALCHEMY_API_KEY is set, Base's public RPC otherwise. */
export function baseRpc(env: Record<string, string | undefined> = process.env): {
  url: string;
  source: VerifierSource;
} {
  const key = env.ALCHEMY_API_KEY;
  return key
    ? { url: `https://base-mainnet.g.alchemy.com/v2/${key}`, source: "alchemy" }
    : { url: env.BASE_RPC_URL || "https://mainnet.base.org", source: "public-rpc" };
}

/**
 * Verifies a real-data payment on Base: the receipt succeeded and holds a USDC Transfer of the exact
 * amount from the traveler's Passport wallet. `getReceipt` is injectable for tests.
 */
export function createBaseVerifier(
  rpc: { url: string; source: VerifierSource },
  getReceipt?: (tx: Hex) => Promise<ReceiptLike | null>,
): PaymentVerifier {
  const client = createPublicClient({ transport: http(rpc.url, { timeout: 15_000 }) });
  const fetchReceipt =
    getReceipt ??
    (async (tx: Hex) => {
      try {
        return (await client.getTransactionReceipt({ hash: tx })) as unknown as ReceiptLike;
      } catch {
        return null;
      }
    });
  return {
    source: rpc.source,
    async verify(tx, exp) {
      if (!/^0x[0-9a-fA-F]{64}$/.test(tx)) return false;
      const r = await fetchReceipt(tx as Hex);
      if (!r) return null;
      return verifyRefundInReceipt(r, { token: BASE_USDC, from: exp.from, amountAtomic: exp.amountAtomic });
    },
  };
}
