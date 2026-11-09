import { formatMoney, type Explanation, type NoticeFacts, type RightsAssessment } from "@layover/shared";
import type { ServClient } from "../serv/client";
import { noticeParse } from "../serv/prompts/noticeParse";
import { rightsExplain } from "../serv/prompts/rightsExplain";

/** SERV NoticeParse; on any failure returns null so the engine falls back to the flight feed. */
export async function parseNotice(
  serv: ServClient,
  text: string,
): Promise<{ facts: NoticeFacts | null; error?: string }> {
  if (!text.trim()) return { facts: null };
  try {
    return { facts: normalizeFacts(await noticeParse(serv, text)) };
  } catch (e) {
    return { facts: null, error: (e as Error).message };
  }
}

/** Model timestamps can come back as "unknown" or "2026-12-21 08:40Z": keep valid instants (as ISO), null the rest. */
export function normalizeTimestamp(v: string | null): string | null {
  if (!v) return null;
  const m = /(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*(Z|[+-]\d{2}:?\d{2})?/.exec(v);
  if (!m) return null;
  const off =
    !m[5] || m[5] === "Z" ? "Z" : m[5].includes(":") ? m[5] : `${m[5].slice(0, 3)}:${m[5].slice(3)}`;
  const t = Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4] ?? "00"}${off}`);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

export function normalizeFacts(f: NoticeFacts): NoticeFacts {
  return { ...f, newDepUtc: normalizeTimestamp(f.newDepUtc), noticeAtUtc: normalizeTimestamp(f.noticeAtUtc) };
}

const KIND_LABEL: Record<string, string> = {
  refund: "a full refund",
  reroute: "re-routing on another flight",
  compensation: "compensation",
  care_meal: "meals while you wait",
  care_hotel: "a hotel tonight",
  care_transport: "transport to the hotel",
};

/** Plain explanation built only from the assessment; used when SERV's explanation fails its checks. */
export function deterministicExplanation(a: RightsAssessment): Explanation {
  const best = a.packs.find((p) => a.bestRemedy.startsWith(p.pack)) ?? a.packs[0];
  const ORDER = ["care_hotel", "care_meal", "care_transport", "compensation", "refund", "reroute"];
  const urgentFirst = [...(best?.entitlements ?? [])].sort(
    (a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind),
  );
  const bullets = urgentFirst.slice(0, 5).map((e) => {
    const amt = e.amount
      ? ` of ${formatMoney(e.amount)}`
      : e.amountUpTo
        ? ` of up to ${formatMoney(e.amountUpTo)}`
        : "";
    return `You may be owed ${KIND_LABEL[e.kind] ?? e.kind}${amt} (${e.confidence === "HIGH" ? "clear rule" : "check the rule"}).`;
  });
  const doNot = [...new Set(a.packs.flatMap((p) => p.doNot))].slice(0, 3);
  return {
    headline: best?.actions[0] ?? "Keep your receipts; Layover is tracking your rights.",
    bullets,
    doNot,
    disclaimer: a.disclaimer,
  };
}

export async function explainRights(
  serv: ServClient,
  a: RightsAssessment,
): Promise<Explanation & { source: "serv" | "deterministic" }> {
  try {
    return { ...(await rightsExplain(serv, a)), source: "serv" };
  } catch {
    return { ...deterministicExplanation(a), source: "deterministic" };
  }
}
