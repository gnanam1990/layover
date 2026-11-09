import type { ZodType } from "zod";
import type { Clock } from "../clock";
import type { PassportAdapter } from "../passport/adapter";
import { PassportError } from "../passport/errors";
import { usdToMicros } from "../passport/adapter";
import { BASE_CHAIN_ID, type PaymentVerifier } from "./base-verify";

export interface DataPurchase {
  label: string;
  url: string;
  amount?: string;
  tx?: string;
  chainId?: number;
  explorerUrl?: string;
  atUtc: string;
  /** On-chain check of the payment (Base receipt): true/false once known, absent while pending or unverifiable. */
  verified?: boolean;
}

export class DataUnavailableError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "DataUnavailableError";
  }
}

const EXPLORERS: Record<number, string> = {
  8453: "https://basescan.org/tx/",
  84532: "https://sepolia.basescan.org/tx/",
  2366: "https://kitescan.ai/tx/",
  2368: "https://testnet.kitescan.ai/tx/",
};

/**
 * Buys real data from Kite's paid-service catalog. Every call is an x402 payment through Kite Passport,
 * paid from the owner's account allowance so it never touches the trip's booking session (asset lock).
 */
export interface BuyerVerification {
  verifier: PaymentVerifier;
  /** The traveler's Passport wallet (the payer on-chain). */
  payer: () => Promise<string | undefined>;
  pollMs?: number;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export class DataBuyer {
  readonly purchases: DataPurchase[] = [];
  private pendingChecks = new Set<Promise<void>>();
  constructor(
    private passport: PassportAdapter,
    private clock: Clock,
    private verification?: BuyerVerification,
  ) {}

  get verifierSource() {
    return this.verification?.verifier.source ?? null;
  }

  /** Resolves when every started on-chain check has finished (tests, shutdown). */
  async settled() {
    await Promise.all([...this.pendingChecks]);
  }

  private startVerification(p: DataPurchase) {
    const v = this.verification;
    if (!v || !p.tx || p.chainId !== BASE_CHAIN_ID || !p.amount) return;
    const sleep = v.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    const run = (async () => {
      const from = await v.payer().catch(() => undefined);
      if (!from) return;
      const amountAtomic = usdToMicros(p.amount!); // USDC has 6 decimals, same as our micros
      const deadline = Date.now() + (v.timeoutMs ?? 90_000);
      for (;;) {
        const ok = await v.verifier.verify(p.tx!, { from, amountAtomic }).catch(() => null);
        if (ok !== null) {
          p.verified = ok;
          return;
        }
        if (Date.now() >= deadline) return;
        await sleep(v.pollMs ?? 3_000);
      }
    })();
    this.pendingChecks.add(run);
    void run.finally(() => this.pendingChecks.delete(run));
  }

  async get<T>(url: string, schema: ZodType<T>, label: string): Promise<{ data: T; purchase: DataPurchase }> {
    let r;
    try {
      r = await this.passport.execute({
        url,
        method: "GET",
        idempotencyKey: `data:${crypto.randomUUID()}`,
        useAllowance: true,
      });
    } catch (e) {
      throw new DataUnavailableError(
        e instanceof PassportError ? `${e.code}: ${e.hint}` : (e as Error).message,
      );
    }
    if (r.status < 200 || r.status >= 300)
      throw new DataUnavailableError(`${label}: provider answered ${r.status}`, r.status);
    const parsed = schema.safeParse(r.body);
    if (!parsed.success) throw new DataUnavailableError(`${label}: unexpected response shape`);
    const chainId = r.payment?.chainId;
    const purchase: DataPurchase = {
      label,
      url,
      ...(r.payment?.amount && { amount: r.payment.amount }),
      ...(r.payment?.tx && { tx: r.payment.tx }),
      ...(chainId && { chainId }),
      ...(r.payment?.tx &&
        chainId &&
        EXPLORERS[chainId] && { explorerUrl: `${EXPLORERS[chainId]}${r.payment.tx}` }),
      atUtc: this.clock.now().toISOString(),
    };
    this.purchases.push(purchase);
    this.startVerification(purchase);
    return { data: parsed.data, purchase };
  }
}

/** Timeline link for a data purchase ("FlightAware status · $0.01 via Kite ↗"). */
export function purchaseLink(p: DataPurchase) {
  return p.explorerUrl ? [{ label: `${p.label} · $${p.amount ?? "?"} via Kite`, url: p.explorerUrl }] : [];
}
