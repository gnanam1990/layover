/** Minimal x402 v2 wire helpers shared by FakePassport and DirectX402Payer. */
export interface Accepts {
  scheme: string;
  network: string;
  asset: string;
  amount: string;
  payTo: string;
  maxTimeoutSeconds?: number;
  extra?: { name?: string; version?: string } & Record<string, unknown>;
}
export interface PaymentRequired {
  x402Version: number;
  resource?: unknown;
  accepts: Accepts[];
}

export const b64json = (v: unknown) =>
  Buffer.from(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x))).toString("base64");
export const fromB64json = <T>(s: string): T => JSON.parse(Buffer.from(s, "base64").toString("utf8")) as T;

export function readPaymentRequired(res: Response): PaymentRequired | null {
  const h = res.headers.get("PAYMENT-REQUIRED");
  return h ? fromB64json<PaymentRequired>(h) : null;
}

export function readSettlementTx(res: Response): string | undefined {
  const h = res.headers.get("PAYMENT-RESPONSE");
  if (!h) return undefined;
  try {
    return fromB64json<{ transaction?: string }>(h).transaction;
  } catch {
    return undefined;
  }
}

export async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function requestInit(
  p: { method: string; headers?: Record<string, string>; body?: unknown },
  extra: Record<string, string> = {},
): RequestInit {
  return {
    method: p.method,
    headers: { ...(p.body !== undefined && { "content-type": "application/json" }), ...p.headers, ...extra },
    ...(p.body !== undefined && { body: JSON.stringify(p.body) }),
  };
}
