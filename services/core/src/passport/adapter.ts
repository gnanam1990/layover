/**
 * Everything Layover pays goes through this interface (TDD §5), adapted to kpass 6.13 (DECISIONS D5).
 * Amounts are **settled** USD decimal strings (display price ÷ PRICE_SCALE), e.g. "0.72".
 */
export interface SessionRequest {
  taskSummary: string;
  maxPerTx: string;
  maxTotal: string;
  ttlSeconds: number;
  /** Recorded with the session by Passport (not enforced on paid calls today). */
  allowedEndpoints?: { method: string; host: string; path_prefix: string }[];
}

export interface SessionRequested {
  requestId: string;
  approvalUrl: string;
  userMessage?: string;
}

export interface SessionResolution {
  status: "active" | "rejected" | "timeout";
  sessionId?: string;
  expiresAt?: string;
}

export interface ExecuteRequest {
  url: string;
  method: "GET" | "POST";
  headers?: Record<string, string>;
  body?: unknown;
  /** Stable per operation (e.g. tripId:bookingId:offerId); reused verbatim on retries. */
  idempotencyKey: string;
  sessionId?: string;
  /** Pay from the owner's account allowance instead of the trip session (small real-data purchases). */
  useAllowance?: boolean;
}

export interface PaymentInfo {
  tx?: string;
  amount?: string;
  asset?: string;
  chainId?: number;
}

export interface ExecuteResult {
  /** HTTP status returned by the merchant (not by Passport). */
  status: number;
  body: unknown;
  /** Present only when a payment settled. */
  payment?: PaymentInfo;
}

export interface PassportStatus {
  loggedIn: boolean;
  email?: string;
  wallet?: string;
  sandbox?: boolean;
  /** The agent identity Kite Passport knows Layover by (verifiable identity, Kite track). */
  agent?: { id: string; type: string };
}

export type PayerKind = "passport" | "direct" | "fake";

export interface PassportAdapter {
  readonly kind: PayerKind;
  status(): Promise<PassportStatus>;
  walletAddress(): Promise<string | undefined>;
  requestSession(p: SessionRequest): Promise<SessionRequested>;
  awaitSession(requestId: string, timeoutMs: number): Promise<SessionResolution>;
  execute(p: ExecuteRequest): Promise<ExecuteResult>;
}

/** 6-decimal fixed-point helpers for settled USD strings (no floats). */
export const USD_MICROS = 1_000_000n;
export function usdToMicros(s: string): bigint {
  const m = /^(\d+)(?:\.(\d{1,6}))?$/.exec(s.trim());
  if (!m) throw new RangeError(`bad USD amount "${s}"`);
  return BigInt(m[1]!) * USD_MICROS + BigInt((m[2] ?? "").padEnd(6, "0"));
}
export function microsToUsd(micros: bigint): string {
  const whole = micros / USD_MICROS;
  const frac = (micros % USD_MICROS).toString().padStart(6, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}
/** Display minor units (cents) → settled USD string under PRICE_SCALE: 12000 @100 → "1.2". */
export function settledUsd(displayMinor: bigint, priceScale: number): string {
  return microsToUsd((displayMinor * 10_000n) / BigInt(priceScale));
}
