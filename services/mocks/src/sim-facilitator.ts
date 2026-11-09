import type { FacilitatorClient } from "@x402/core/server";

type Args = Parameters<FacilitatorClient["verify"]>;

/**
 * Simulated facilitator for tests and offline dev (dependency-injected like kite-x402-hono does).
 * It accepts any payload whose `accepted` requirements match and returns a fake settlement tx.
 */
export class SimulatedFacilitator implements FacilitatorClient {
  verifyCalls = 0;
  settleCalls = 0;
  constructor(private networks: string[] = ["eip155:2368", "eip155:2366"]) {}

  async verify(_payload: Args[0], _req: Args[1]) {
    this.verifyCalls++;
    return { isValid: true, payer: "0x2222222222222222222222222222222222222222" };
  }

  async settle(_payload: Args[0], req: Args[1]) {
    this.settleCalls++;
    return {
      success: true,
      transaction: `0xsim${String(this.settleCalls).padStart(60, "0")}`,
      network: req.network,
      payer: "0x2222222222222222222222222222222222222222",
    };
  }

  async getSupported() {
    return {
      kinds: this.networks.map((network) => ({
        x402Version: 2,
        scheme: "exact",
        network: network as `${string}:${string}`,
      })),
      extensions: [],
      signers: {},
    };
  }
}
