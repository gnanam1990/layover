import { paymentMiddleware, x402ResourceServer } from "@x402/hono";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import type { FacilitatorClient } from "@x402/core/server";
import { toAtomic } from "@layover/shared";
import { NETWORKS, TIERS, type KiteNetwork } from "./config";

export interface PaywallOpts {
  facilitator: FacilitatorClient;
  network: KiteNetwork;
  payTo: string;
  priceScale: number;
}

/**
 * One paid route per rate tier: POST /v1/book/<tier> costs tier/PRICE_SCALE in the network's stablecoin.
 * Order is verify → handler → settle only if the handler returned < 400 (enforced by @x402/hono).
 */
export function tierRoutes(o: Omit<PaywallOpts, "facilitator">) {
  const net = NETWORKS[o.network];
  const routes: Record<string, { accepts: object[]; description: string; mimeType: string }> = {};
  for (const tier of TIERS) {
    const amount = toAtomic(BigInt(tier) * 100n, net.decimals, o.priceScale).toString();
    routes[`POST /v1/book/${tier}`] = {
      accepts: [
        {
          scheme: "exact",
          network: net.caip2,
          payTo: o.payTo,
          price: { asset: net.token, amount, extra: { ...net.eip712 } },
          maxTimeoutSeconds: 120,
        },
      ],
      description: tier === 1 ? "Layover spike: test payment" : `Layover mock hotel booking, $${tier} tier`,
      mimeType: "application/json",
    };
  }
  return routes;
}

export function createPaywall(o: PaywallOpts) {
  const net = NETWORKS[o.network];
  const server = new x402ResourceServer(o.facilitator).register(net.caip2, new ExactEvmScheme());
  // Types of the route config are looser than ours; the shape follows the @x402/hono README.
  return paymentMiddleware(tierRoutes(o) as Parameters<typeof paymentMiddleware>[0], server);
}
