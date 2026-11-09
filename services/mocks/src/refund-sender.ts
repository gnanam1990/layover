import { createWalletClient, defineChain, http, parseAbi, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { NetworkConfig } from "./config";

export interface RefundSender {
  /** Sends `atomic` token units to `to`; idempotent per `idemKey`. Returns the tx hash. */
  send(to: string, atomic: bigint, idemKey: string): Promise<string>;
}

const ERC20 = parseAbi(["function transfer(address to, uint256 value) returns (bool)"]);

/** Merchant → traveler ERC-20 refund signed with MERCHANT_REFUND_KEY (server-side only). */
export function createViemRefundSender(net: NetworkConfig, privateKey: Hex): RefundSender {
  const chain = defineChain({
    id: net.chainId,
    name: `Kite ${net.chainId}`,
    nativeCurrency: { name: "KITE", symbol: "KITE", decimals: 18 },
    rpcUrls: { default: { http: [net.rpcUrl] } },
  });
  const account = privateKeyToAccount(privateKey);
  const wallet = createWalletClient({ account, chain, transport: http(net.rpcUrl, { timeout: 30_000 }) });
  const sent = new Map<string, Promise<string>>();
  return {
    send(to, atomic, idemKey) {
      const existing = sent.get(idemKey);
      if (existing) return existing;
      const p = wallet.writeContract({
        address: net.token,
        abi: ERC20,
        functionName: "transfer",
        args: [to as Hex, atomic],
      });
      sent.set(idemKey, p);
      p.catch(() => sent.delete(idemKey));
      return p;
    },
  };
}

/** Used when no MERCHANT_REFUND_KEY is configured: refunds are recorded but clearly fake. */
export const unconfiguredRefundSender: RefundSender = {
  async send() {
    throw new Error("refund sender not configured: set MERCHANT_REFUND_KEY");
  },
};
