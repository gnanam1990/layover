import { redact } from "./redact";

export const SESSION_FATAL_CODES = new Set([
  "session_rule_exceeded",
  "session_total_exceeded",
  "separate_session_used_up",
  "session_endpoint_forbidden",
  "session_asset_forbidden",
  "session_forbidden",
  "payment_target_forbidden",
]);

const HINTS: Record<string, string> = {
  session_rule_exceeded:
    "The price is above the per-payment limit you approved. Approve a new session with a higher limit.",
  session_total_exceeded:
    "The trip budget is used up (total limit reached). Approve a new session to keep protecting this trip.",
  separate_session_used_up: "The trip session's total budget is used up. Approve a new session to continue.",
  session_endpoint_forbidden:
    "This endpoint is outside the session's scope. Approve a new session for this merchant.",
  session_asset_forbidden:
    "The merchant asked for a different token than this session settled in. Approve a new session.",
  session_forbidden: "No active session: it expired or was never approved. Approve a new trip session.",
  payment_target_forbidden:
    "Kite Passport refused to pay this merchant (not allowlisted). See the fallback ladder in DECISIONS.",
  wallet_empty: "Your Passport wallet has no funds for this payment. Add funds, then retry.",
  insufficient_balance: "Your Passport wallet balance is too low. Add funds, then retry.",
  payment_outcome_pending: "The payment may have gone through; it is being checked. Do not pay again.",
  allowance_unavailable: "No approved session and no account allowance. Approve a trip session first.",
  provider_unavailable: "Kite Passport is temporarily unavailable. Try again shortly.",
  not_logged_in:
    "Sign in to Kite Passport first: kpass login init --email you@example.com (or signup init), then kpass sandbox on.",
  agent_not_registered:
    "Layover isn't registered as an agent in Kite Passport yet; it registers itself on the next try.",
  unknown: "Kite Passport returned an unexpected error.",
};

export class PassportError extends Error {
  constructor(
    readonly code: string,
    readonly hint: string,
    readonly exitCode: number,
    readonly userMessage?: string,
  ) {
    super(`${code}: ${hint}`);
    this.name = "PassportError";
  }
  /** Cap/scope/expiry errors: the session must not be used again (never retry on the same session). */
  get sessionFatal(): boolean {
    return SESSION_FATAL_CODES.has(this.code);
  }
  toJSON() {
    return { name: this.name, code: this.code, hint: this.hint, exitCode: this.exitCode };
  }
}

export function mapKpassError(j: Record<string, unknown>, exitCode: number): PassportError {
  // Some kpass errors (auth, registration) carry no error_code: classify them from the message.
  const msg = typeof j.error === "string" ? j.error : "";
  const inferred = /agent not registered/i.test(msg)
    ? "agent_not_registered"
    : exitCode === 3 || /not logged in|log ?in|sign ?up|no user session/i.test(msg)
      ? "not_logged_in"
      : "unknown";
  const raw = typeof j.error_code === "string" && j.error_code ? j.error_code : inferred;
  const code = raw in HINTS ? raw : raw === "unknown" ? "unknown" : raw;
  const hint = HINTS[code] ?? HINTS.unknown!;
  const userMessage = typeof j.user_message === "string" ? String(redact(j.user_message)) : undefined;
  return new PassportError(code, hint, exitCode, userMessage);
}
