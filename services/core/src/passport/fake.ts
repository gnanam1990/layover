import type { Clock } from "../clock";
import { systemClock } from "../clock";
import {
  microsToUsd,
  usdToMicros,
  type ExecuteRequest,
  type ExecuteResult,
  type PassportAdapter,
  type PassportStatus,
  type SessionRequest,
  type SessionRequested,
  type SessionResolution,
} from "./adapter";
import { PassportError, mapKpassError } from "./errors";
import { b64json, readBody, readPaymentRequired, readSettlementTx, requestInit } from "./x402";

interface FakeSession {
  requestId: string;
  sessionId: string;
  maxPerTx: bigint;
  maxTotal: bigint;
  ttlSeconds: number;
  status: "requested" | "active" | "rejected";
  activatedAt?: number;
  spent: bigint;
}

/**
 * In-memory Kite Passport. Enforces per-tx, total and TTL exactly like Kite and returns Kite's error codes.
 * Pays merchants by echoing their 402 `accepts[0]` (works with the simulated facilitator).
 */
export class FakePassport implements PassportAdapter {
  readonly kind = "fake" as const;
  readonly wallet = "0x2222222222222222222222222222222222222222";
  private sessions = new Map<string, FakeSession>();
  private current?: FakeSession;
  private idem = new Map<string, ExecuteResult>();
  private seq = 0;
  private fetchFn: typeof globalThis.fetch;
  private clock: Clock;
  private decimals: number;
  executeCalls = 0;

  constructor(o: { fetch?: typeof globalThis.fetch; clock?: Clock; tokenDecimals?: number } = {}) {
    this.fetchFn = o.fetch ?? globalThis.fetch;
    this.clock = o.clock ?? systemClock;
    this.decimals = o.tokenDecimals ?? 18;
  }

  async status(): Promise<PassportStatus> {
    return { loggedIn: true, email: "fake@layover.test", wallet: this.wallet, sandbox: true };
  }
  async walletAddress() {
    return this.wallet;
  }

  async requestSession(p: SessionRequest): Promise<SessionRequested> {
    const n = ++this.seq;
    const s: FakeSession = {
      requestId: `req_fake_${n}`,
      sessionId: `session_fake_${n}`,
      maxPerTx: usdToMicros(p.maxPerTx),
      maxTotal: usdToMicros(p.maxTotal),
      ttlSeconds: p.ttlSeconds,
      status: "requested",
      spent: 0n,
    };
    this.sessions.set(s.requestId, s);
    return {
      requestId: s.requestId,
      approvalUrl: `https://agentpassport.test/approve?request=${s.requestId}`,
      userMessage: `Approve up to USD ${p.maxPerTx} per call and USD ${p.maxTotal} in total.`,
    };
  }

  /** Test/demo helper: what the traveler's passkey tap does. */
  approve(requestId: string) {
    const s = this.sessions.get(requestId);
    if (!s) throw new Error(`unknown request ${requestId}`);
    s.status = "active";
    s.activatedAt = this.clock.now().getTime();
    this.current = s;
  }
  reject(requestId: string) {
    const s = this.sessions.get(requestId);
    if (s) s.status = "rejected";
  }

  async awaitSession(requestId: string, timeoutMs: number): Promise<SessionResolution> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const s = this.sessions.get(requestId);
      if (s?.status === "active") {
        return {
          status: "active",
          sessionId: s.sessionId,
          expiresAt: new Date(s.activatedAt! + s.ttlSeconds * 1000).toISOString(),
        };
      }
      if (s?.status === "rejected") return { status: "rejected" };
      if (Date.now() >= deadline) return { status: "timeout" };
      await new Promise((r) => setTimeout(r, 10));
    }
  }

  spentTotal(): string {
    return microsToUsd(this.current?.spent ?? 0n);
  }

  async execute(p: ExecuteRequest): Promise<ExecuteResult> {
    this.executeCalls++;
    const cached = this.idem.get(p.idempotencyKey);
    if (cached) return cached;
    const s = p.sessionId
      ? [...this.sessions.values()].find((x) => x.sessionId === p.sessionId)
      : this.current;
    const now = this.clock.now().getTime();
    if (!s || s.status !== "active" || now >= s.activatedAt! + s.ttlSeconds * 1000) {
      throw mapKpassError({ error_code: "session_forbidden", error: "no active session" }, 6);
    }

    const first = await this.fetchFn(p.url, requestInit(p));
    if (first.status !== 402) return { status: first.status, body: await readBody(first) };
    const req = readPaymentRequired(first);
    const accepted = req?.accepts[0];
    if (!req || !accepted) throw new PassportError("unknown", "merchant 402 had no payment requirements", 1);

    const priceMicros = BigInt(accepted.amount) / 10n ** BigInt(this.decimals - 6);
    if (priceMicros > s.maxPerTx) throw mapKpassError({ error_code: "session_rule_exceeded" }, 6);
    if (s.spent + priceMicros > s.maxTotal) throw mapKpassError({ error_code: "session_total_exceeded" }, 6);

    const payload = {
      x402Version: req.x402Version,
      resource: req.resource,
      accepted,
      payload: { signature: "0xfake", authorization: { from: this.wallet } },
    };
    const paid = await this.fetchFn(p.url, requestInit(p, { "PAYMENT-SIGNATURE": b64json(payload) }));
    const body = await readBody(paid);
    const tx = readSettlementTx(paid);
    let result: ExecuteResult = { status: paid.status, body };
    if (paid.status < 400 && tx) {
      s.spent += priceMicros;
      result = {
        ...result,
        payment: {
          tx,
          amount: microsToUsd(priceMicros),
          asset: accepted.extra?.name,
          chainId: Number(accepted.network.split(":")[1]),
        },
      };
    }
    this.idem.set(p.idempotencyKey, result);
    return result;
  }
}
