import { verifyTypedData, type Hex } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import {
  microsToUsd,
  type ExecuteRequest,
  type ExecuteResult,
  type PassportAdapter,
  type PassportStatus,
  type SessionRequest,
  type SessionRequested,
  type SessionResolution,
} from "./adapter";
import { PassportError } from "./errors";
import { b64json, readBody, readPaymentRequired, readSettlementTx, requestInit } from "./x402";

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

interface Signed {
  domain: { name: string; version: string; chainId: number; verifyingContract: Hex };
  message: { from: Hex; to: Hex; value: bigint; validAfter: bigint; validBefore: bigint; nonce: Hex };
  signature: Hex;
}

/**
 * Fallback rung F2 (TDD §5.3): pays an x402 merchant directly with an EIP-3009 authorization signed by a
 * funded **testnet** agent key. Same `execute()` contract as Passport; sessions are local caps only.
 */
export class DirectX402Payer implements PassportAdapter {
  readonly kind = "direct" as const;
  private account: PrivateKeyAccount;
  private fetchFn: typeof globalThis.fetch;
  private chainId: number;
  private decimals: number;
  lastAuthorization?: Signed;

  constructor(o: {
    privateKey: Hex;
    fetch?: typeof globalThis.fetch;
    chainId: number;
    tokenDecimals?: number;
  }) {
    this.account = privateKeyToAccount(o.privateKey);
    this.fetchFn = o.fetch ?? globalThis.fetch;
    this.chainId = o.chainId;
    this.decimals = o.tokenDecimals ?? 18;
  }

  async status(): Promise<PassportStatus> {
    return { loggedIn: true, wallet: this.account.address, sandbox: this.chainId === 2368 };
  }
  async walletAddress() {
    return this.account.address;
  }
  // F2 has no passkey step: the trip "session" is approved locally and capped by the policy gate.
  async requestSession(_p: SessionRequest): Promise<SessionRequested> {
    return {
      requestId: `req_direct_${Date.now()}`,
      approvalUrl: "about:direct-x402",
      userMessage: "Direct x402 (testnet): no passkey step.",
    };
  }
  async awaitSession(requestId: string): Promise<SessionResolution> {
    return { status: "active", sessionId: requestId.replace("req_", "session_") };
  }

  async execute(p: ExecuteRequest): Promise<ExecuteResult> {
    const first = await this.fetchFn(p.url, requestInit(p));
    if (first.status !== 402) return { status: first.status, body: await readBody(first) };
    const req = readPaymentRequired(first);
    const a = req?.accepts[0];
    if (!req || !a) throw new PassportError("unknown", "merchant 402 had no payment requirements", 1);
    if (Number(a.network.split(":")[1]) !== this.chainId) {
      throw new PassportError(
        "payment_target_forbidden",
        `merchant wants ${a.network}, payer is on ${this.chainId}`,
        6,
      );
    }
    const now = BigInt(Math.floor(Date.now() / 1000));
    const nonce = `0x${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex")}` as Hex;
    const domain = {
      name: a.extra?.name ?? "",
      version: a.extra?.version ?? "1",
      chainId: this.chainId,
      verifyingContract: a.asset as Hex,
    };
    const message = {
      from: this.account.address,
      to: a.payTo as Hex,
      value: BigInt(a.amount),
      validAfter: 0n,
      validBefore: now + BigInt(a.maxTimeoutSeconds ?? 120),
      nonce,
    };
    const signature = await this.account.signTypedData({
      domain,
      types: TYPES,
      primaryType: "TransferWithAuthorization",
      message,
    });
    this.lastAuthorization = { domain, message, signature };
    const payload = {
      x402Version: req.x402Version,
      resource: req.resource,
      accepted: a,
      payload: {
        signature,
        authorization: {
          from: message.from,
          to: message.to,
          value: message.value.toString(),
          validAfter: message.validAfter.toString(),
          validBefore: message.validBefore.toString(),
          nonce,
        },
      },
    };
    const paid = await this.fetchFn(p.url, requestInit(p, { "PAYMENT-SIGNATURE": b64json(payload) }));
    const body = await readBody(paid);
    const tx = readSettlementTx(paid);
    if (paid.status >= 400 || !tx) return { status: paid.status, body };
    const micros = BigInt(a.amount) / 10n ** BigInt(this.decimals - 6);
    return {
      status: paid.status,
      body,
      payment: { tx, amount: microsToUsd(micros), asset: a.extra?.name, chainId: this.chainId },
    };
  }

  async verifyLastSignature(): Promise<boolean> {
    const s = this.lastAuthorization;
    if (!s) return false;
    return verifyTypedData({
      address: this.account.address,
      domain: s.domain,
      types: TYPES,
      primaryType: "TransferWithAuthorization",
      message: s.message,
      signature: s.signature,
    });
  }
}
