import { describe, expect, test } from "bun:test";
import { verifyTypedData, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createFacilitatorRefundSender } from "../src/facilitator-refund";
import { SimulatedFacilitator } from "../src/sim-facilitator";
import { NETWORKS } from "../src/config";

const KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;
const TRAVELER = "0x2222222222222222222222222222222222222222";

describe("facilitator refund (no merchant gas)", () => {
  test("signs merchant → traveler for the exact amount and has the facilitator settle it", async () => {
    const f = new SimulatedFacilitator();
    const net = NETWORKS.mainnet;
    const sender = createFacilitatorRefundSender(net, KEY, f);
    const tx = await sender.send(TRAVELER, 720000n, "HX-2231"); // $72 at 1:100 in USDC.e (6 dp)
    expect(tx).toMatch(/^0xsim/);
    expect(f.verifyCalls).toBe(1);
    expect(f.settleCalls).toBe(1);
    const req = sender.last!.requirements as unknown as Record<string, unknown>;
    expect(req).toMatchObject({
      scheme: "exact",
      network: "eip155:2366",
      asset: net.token,
      amount: "720000",
      payTo: TRAVELER,
    });
    const auth = (
      sender.last!.payload as unknown as {
        payload: { signature: Hex; authorization: Record<string, string> };
      }
    ).payload;
    expect(auth.authorization.from).toBe(privateKeyToAccount(KEY).address);
    const ok = await verifyTypedData({
      address: privateKeyToAccount(KEY).address,
      domain: { ...net.eip712, chainId: net.chainId, verifyingContract: net.token },
      types: {
        TransferWithAuthorization: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "validAfter", type: "uint256" },
          { name: "validBefore", type: "uint256" },
          { name: "nonce", type: "bytes32" },
        ],
      },
      primaryType: "TransferWithAuthorization",
      message: {
        from: auth.authorization.from as Hex,
        to: auth.authorization.to as Hex,
        value: BigInt(auth.authorization.value!),
        validAfter: BigInt(auth.authorization.validAfter!),
        validBefore: BigInt(auth.authorization.validBefore!),
        nonce: auth.authorization.nonce as Hex,
      },
      signature: auth.signature,
    });
    expect(ok).toBe(true);
  });

  test("idempotent per refund key; a rejected verification throws and can be retried", async () => {
    const f = new SimulatedFacilitator();
    const sender = createFacilitatorRefundSender(NETWORKS.testnet, KEY, f);
    const a = await sender.send(TRAVELER, 1n, "k");
    const b = await sender.send(TRAVELER, 1n, "k");
    expect(a).toBe(b);
    expect(f.settleCalls).toBe(1);
    const bad = new SimulatedFacilitator();
    bad.verify = async () => ({ isValid: false, invalidReason: "invalid_signature", payer: "" });
    const s2 = createFacilitatorRefundSender(NETWORKS.testnet, KEY, bad);
    await expect(s2.send(TRAVELER, 1n, "x")).rejects.toThrow(/invalid_signature/);
  });
});
