import { ClaimLetter } from "@layover/shared";
import type { ServClient } from "../client";

export const CLAIM_DRAFT_MODEL = "claude-sonnet-5.5";
export const CLAIM_DRAFT_FALLBACK = "gpt-5.4-mini";
export const CLAIM_DRAFT_SYSTEM = `You draft a passenger claim letter/email to an airline from ClaimData JSON. Use only facts in ClaimData. Structure: subject line; greeting; flight and booking details; what happened (from timeline); each entitlement requested with its legal basis label exactly as given; reimbursement of care costs with each receipt (description, amount, transaction link); requested payment method (original form of payment / bank transfer); response deadline of 14 days; sign-off with the traveler's name. No legal threats, no invented law. Output {subject, body}.`;
export const CLAIM_DRAFT_SHADOW_HINT =
  "No entitlement, amount, date, booking reference or receipt may appear unless it is present in the provided ClaimData. The letter must request each entitlement listed, in a polite firm tone, and attach receipts by reference.";

export function claimDraft(
  serv: ServClient,
  claimData: unknown,
  postCheck?: (l: ClaimLetter) => void,
): Promise<ClaimLetter> {
  return serv.call("ClaimDraft", {
    model: CLAIM_DRAFT_MODEL,
    fallbackModels: [CLAIM_DRAFT_FALLBACK],
    system: CLAIM_DRAFT_SYSTEM,
    // ClaimData is assembled by our own code from the rights engine, timeline and payments (trusted).
    user: `ClaimData JSON:\n${JSON.stringify(claimData)}`,
    schema: ClaimLetter,
    tools: [{ shadow: { hint: CLAIM_DRAFT_SHADOW_HINT, maxIterations: 2 } }],
    ...(postCheck && { postCheck }),
  });
}
