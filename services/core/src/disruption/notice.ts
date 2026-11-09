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
    return { facts: await noticeParse(serv, text) };
  } catch (e) {
    return { facts: null, error: (e as Error).message };
  }
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
