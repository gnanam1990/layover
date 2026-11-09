import type { FacilitatorClient } from "@x402/core/server";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { NetworkConfig } from "./config";
import type { RefundSender } from "./refund-sender";

const TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

type SettleArgs = Parameters<FacilitatorClient["settle"]>;

/**
 * Refunds without the merchant holding KITE for gas: the merchant signs an EIP-3009
 * TransferWithAuthorization (merchant → traveler) and the x402 facilitator settles it on-chain,
 * paying the gas exactly as it does for payments. Idempotent per refund key. (DECISIONS D13)
 */
export function createFacilitatorRefundSender(
  net: NetworkConfig,
  privateKey: Hex,
  facilitator: FacilitatorClient,
  now: () => number = () => Date.now(),
): RefundSender & { last?: { requirements: SettleArgs[1]; payload: SettleArgs[0] } } {
  const account = privateKeyToAccount(privateKey);
  const sent = new Map<string, Promise<string>>();
  const sender: RefundSender & { last?: { requirements: SettleArgs[1]; payload: SettleArgs[0] } } = {
    send(to, atomic, idemKey) {
      const existing = sent.get(idemKey);
      if (existing) return existing;
      const p = (async () => {
        const validBefore = BigInt(Math.floor(now() / 1000) + 600);
        const nonce = `0x${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex")}` as Hex;
        const message = {
          from: account.address,
          to: to as Hex,
          value: atomic,
          validAfter: 0n,
          validBefore,
          nonce,
        };
        const signature = await account.signTypedData({
          domain: { ...net.eip712, chainId: net.chainId, verifyingContract: net.token },
          types: TYPES,
          primaryType: "TransferWithAuthorization",
          message,
        });
        const requirements = {
          scheme: "exact",
          network: net.caip2,
          asset: net.token,
          amount: atomic.toString(),
          payTo: to,
          maxTimeoutSeconds: 600,
          extra: { ...net.eip712 },
        } as unknown as SettleArgs[1];
        const payload = {
          x402Version: 2,
          accepted: requirements,
          payload: {
            signature,
            authorization: {
              from: account.address,
              to,
              value: atomic.toString(),
              validAfter: "0",
              validBefore: validBefore.toString(),
              nonce,
            },
          },
        } as unknown as SettleArgs[0];
        sender.last = { requirements, payload };
        const v = await facilitator.verify(payload, requirements);
        if (!v.isValid) throw new Error(`facilitator rejected the refund: ${v.invalidReason ?? "invalid"}`);
        const r = await facilitator.settle(payload, requirements);
        if (!r.success || !r.transaction)
          throw new Error(`refund settlement failed: ${r.errorReason ?? "unknown"}`);
        return r.transaction;
      })();
      sent.set(idemKey, p);
      p.catch(() => sent.delete(idemKey));
      return p;
    },
  };
  return sender;
}
