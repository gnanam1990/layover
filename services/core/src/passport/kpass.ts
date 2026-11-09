import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
  ExecuteRequest,
  ExecuteResult,
  PassportAdapter,
  PassportStatus,
  SessionRequest,
  SessionRequested,
  SessionResolution,
} from "./adapter";
import { PassportError, mapKpassError } from "./errors";
import { redact } from "./redact";

/**
 * Spike S9 result (kpass 6.13.1): one table of verbs, so a CLI rename is a one-line change.
 * The pack's `agent:session …` form is gone; sessions live under `session …`.
 */
export const KPASS_ARGV = {
  status: ["status"],
  sandboxStatus: ["sandbox", "status"],
  walletBalance: ["wallet", "balance"],
  walletAddress: ["wallet", "address"],
  agentRegister: ["agent:register"],
  sessionCreate: ["session", "create"],
  sessionStatus: ["session", "status"],
  sessionExecute: ["session", "execute"],
} as const satisfies Record<string, readonly string[]>;
export type KpassCommand = keyof typeof KPASS_ARGV;
export type KpassVerbs = Record<KpassCommand, readonly string[]>;

const GLOBAL = ["--output", "json", "--no-interactive"];

export function buildArgv(cmd: KpassCommand, flags: string[], table: KpassVerbs = KPASS_ARGV): string[] {
  return [...table[cmd], ...flags, ...GLOBAL];
}

export type KpassRunner = (
  argv: string[],
  timeoutMs: number,
) => Promise<{ exitCode: number; stdout: string; stderr: string }>;

export function defaultKpassBin(): string {
  if (process.env.KPASS_BIN) return process.env.KPASS_BIN;
  for (const f of ["kpass.exe", "kpass"]) {
    const p = join(homedir(), ".kpass", "bin", f);
    if (existsSync(p)) return p;
  }
  return "kpass";
}

export function bunRunner(bin: string): KpassRunner {
  return async (argv, timeoutMs) => {
    const proc = Bun.spawn([bin, ...argv], {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, KPASS_NO_BROWSER: "1", NO_COLOR: "1" },
    });
    const timer = setTimeout(() => proc.kill(), timeoutMs);
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    clearTimeout(timer);
    return { exitCode, stdout, stderr };
  };
}

function parseJson(stdout: string): Record<string, unknown> {
  // kpass prints one JSON document; tolerate leading log lines.
  const start = stdout.indexOf("{");
  if (start < 0) return {};
  try {
    return JSON.parse(stdout.slice(start)) as Record<string, unknown>;
  } catch {
    return {};
  }
}

const get = (o: unknown, path: string): unknown =>
  path
    .split(".")
    .reduce<unknown>(
      (acc, k) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[k] : undefined),
      o,
    );

export class KpassPassport implements PassportAdapter {
  readonly kind = "passport" as const;
  private run: KpassRunner;
  private verbs: KpassVerbs;
  /** Last command output, redacted, for diagnostics. Never log raw kpass output. */
  lastOutput: unknown;

  private agentType: string;
  constructor(o: { runner?: KpassRunner; bin?: string; verbs?: KpassVerbs; agentType?: string } = {}) {
    this.agentType = o.agentType ?? process.env.KPASS_AGENT_TYPE ?? "layover";
    this.run = o.runner ?? bunRunner(o.bin ?? defaultKpassBin());
    this.verbs = o.verbs ?? KPASS_ARGV;
  }

  private async call(
    cmd: KpassCommand,
    flags: string[],
    timeoutMs = 60_000,
  ): Promise<Record<string, unknown>> {
    const { exitCode, stdout } = await this.run(buildArgv(cmd, flags, this.verbs), timeoutMs);
    const j = parseJson(stdout);
    this.lastOutput = redact(j);
    if (exitCode !== 0 || j.status === "error") throw mapKpassError(j, exitCode);
    return j;
  }

  async status(): Promise<PassportStatus> {
    try {
      const j = await this.call("status", []);
      const email = (get(j, "user.email") ?? get(j, "auth.email") ?? j.email) as string | undefined;
      const wallet = (get(j, "wallet.address") ?? j.wallet_address) as string | undefined;
      const mode = (get(j, "mode") ?? get(j, "sandbox.mode")) as string | undefined;
      const loggedIn = get(j, "user.logged_in") === true || Boolean(email);
      const agentId = get(j, "agent.agent_id") as string | null | undefined;
      const agentType = (get(j, "agent.type") as string | null | undefined) ?? this.agentType;
      return {
        loggedIn,
        ...(email && { email }),
        ...(wallet && { wallet }),
        sandbox: mode === "sandbox",
        ...(agentId && { agent: { id: agentId, type: agentType } }),
      };
    } catch (e) {
      if (e instanceof PassportError) return { loggedIn: false };
      throw e;
    }
  }

  async walletAddress(): Promise<string | undefined> {
    const j = await this.call("walletAddress", []);
    return JSON.stringify(j).match(/0x[0-9a-fA-F]{40}/)?.[0];
  }

  /** kpass ≥ 6 needs the agent registered before it can ask for a session (idempotent; DECISIONS D11). */
  private registered = false;
  async ensureAgentRegistered(): Promise<void> {
    if (this.registered) return;
    await this.call("agentRegister", ["--type", this.agentType]);
    this.registered = true;
  }

  async requestSession(p: SessionRequest): Promise<SessionRequested> {
    await this.ensureAgentRegistered();
    const delegation = {
      task: { summary: p.taskSummary },
      payment_policy: {
        max_amount_per_tx: p.maxPerTx,
        max_total_amount: p.maxTotal,
        ttl_seconds: p.ttlSeconds,
        currency: "USD",
      },
      ...(p.allowedEndpoints?.length && {
        execution_constraints: { x402: { scope_mode: "scoped", allowed_endpoints: p.allowedEndpoints } },
      }),
    };
    const j = await this.call("sessionCreate", [
      "--delegation",
      JSON.stringify(delegation),
      "--separate",
      "--no-reuse",
      "--no-browser",
    ]);
    const requestId = j.request_id as string | undefined;
    const approvalUrl = j.approval_url as string | undefined;
    if (!requestId || !approvalUrl)
      throw new PassportError("unknown", "kpass did not return an approval request", 0);
    return {
      requestId,
      approvalUrl,
      ...(typeof j.user_message === "string" && { userMessage: j.user_message }),
    };
  }

  async awaitSession(requestId: string, timeoutMs: number): Promise<SessionResolution> {
    const secs = Math.max(5, Math.round(timeoutMs / 1000));
    try {
      const j = await this.call(
        "sessionStatus",
        ["--request-id", requestId, "--wait", "--timeout", String(secs)],
        timeoutMs + 15_000,
      );
      const st = (get(j, "session.status") ?? j.session_status) as string | undefined;
      if (st === "active") {
        return {
          status: "active",
          sessionId: (j.session_id ?? get(j, "session.id")) as string,
          ...(typeof get(j, "session.expires_at") === "string" && {
            expiresAt: get(j, "session.expires_at") as string,
          }),
        };
      }
      if (st === "rejected" || j.request_status === "rejected") return { status: "rejected" };
      return { status: "timeout" };
    } catch (e) {
      if (e instanceof PassportError && /reject|denied/i.test(e.code)) return { status: "rejected" };
      throw e;
    }
  }

  async execute(p: ExecuteRequest): Promise<ExecuteResult> {
    const flags = [
      "--url",
      p.url,
      "--method",
      p.method,
      "--idempotency-key",
      p.idempotencyKey,
      ...(p.body !== undefined
        ? ["--headers", JSON.stringify({ "Content-Type": "application/json", ...p.headers })]
        : []),
      ...(p.body === undefined && p.headers ? ["--headers", JSON.stringify(p.headers)] : []),
      ...(p.body !== undefined ? ["--body", JSON.stringify(p.body)] : []),
      ...(p.sessionId ? ["--session-id", p.sessionId] : []),
    ];
    const j = await this.call("sessionExecute", flags, 300_000);
    const status = Number(get(j, "x402.status_code") ?? 0);
    const body = get(j, "x402.parsed_response_body") ?? get(j, "x402.response_body") ?? null;
    const tx = (get(j, "payment.payment_response.reference") ??
      get(j, "payment.payment_response.transaction") ??
      get(j, "payment.transaction_hash") ??
      get(j, "details.tx_hash")) as string | undefined;
    const paid = status > 0 && status < 400 && Boolean(tx || get(j, "payment_requirement.amount"));
    return {
      status,
      body,
      ...(paid && {
        payment: {
          ...(tx && { tx }),
          ...(typeof get(j, "payment_requirement.amount") === "string" && {
            amount: get(j, "payment_requirement.amount") as string,
          }),
          ...(typeof get(j, "payment_requirement.asset") === "string" && {
            asset: get(j, "payment_requirement.asset") as string,
          }),
          ...(typeof get(j, "x402.chain_id") === "number" && { chainId: get(j, "x402.chain_id") as number }),
        },
      }),
    };
  }
}
