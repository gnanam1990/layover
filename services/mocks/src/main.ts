import { HTTPFacilitatorClient } from "@x402/core/server";
import type { Hex } from "viem";
import { createMerchantApp } from "./merchant";
import { MockState } from "./state";
import { NETWORKS, type KiteNetwork } from "./config";
import { createViemRefundSender, unconfiguredRefundSender } from "./refund-sender";
import { SimulatedFacilitator } from "./sim-facilitator";

const env = process.env;
const network = (env.KITE_NETWORK === "mainnet" ? "mainnet" : "testnet") as KiteNetwork;
const port = Number(env.PORT ?? env.MERCHANT_PORT ?? 8601);
const publicUrl = env.MERCHANT_PUBLIC_URL || `http://localhost:${port}`;
const payTo = env.MERCHANT_WALLET;
if (!payTo) console.warn("[merchant] MERCHANT_WALLET is not set: payments cannot settle to a real wallet");

// FACILITATOR_URL=sim runs fully offline (no real settlement); never use it for the recorded demo.
const facilitator =
  env.FACILITATOR_URL === "sim"
    ? new SimulatedFacilitator()
    : new HTTPFacilitatorClient({ url: env.FACILITATOR_URL || "https://facilitator.pieverse.io/v2" });

const refundSender = env.MERCHANT_REFUND_KEY
  ? createViemRefundSender(NETWORKS[network], env.MERCHANT_REFUND_KEY as Hex)
  : unconfiguredRefundSender;

const coreUrl = env.CORE_URL;
const app = createMerchantApp({
  state: new MockState(env.MOCK_STATE_FILE ?? ".state.json"),
  facilitator,
  refundSender,
  network,
  payTo: payTo ?? "0x0000000000000000000000000000000000000001",
  priceScale: Number(env.PRICE_SCALE ?? 100),
  demoMode: env.DEMO_MODE === "1",
  adminToken: env.ADMIN_TOKEN ?? "change-me",
  publicUrl,
  notifySimulated: async () => {
    if (!coreUrl) return;
    await fetch(`${coreUrl}/internal/simulated`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-layover-token": env.LAYOVER_LOCAL_TOKEN ?? "change-me",
      },
      body: JSON.stringify({ tripId: "*" }),
    }).catch(() => console.warn("[merchant] could not notify core about a simulated event"));
  },
});

console.log(`layover-merchant on :${port} · ${NETWORKS[network].caip2} · public ${publicUrl}`);
export default { port, fetch: app.fetch };
