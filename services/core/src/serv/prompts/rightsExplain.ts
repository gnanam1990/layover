import { Explanation, type RightsAssessment } from "@layover/shared";
import { ServValidationError, type ServClient } from "../client";

export const RIGHTS_EXPLAIN_MODEL = "gpt-5.4-mini-serv-kronos";
export const RIGHTS_EXPLAIN_SYSTEM = `You explain a passenger-rights assessment to a stressed traveler in plain, calm English. Input is a RightsAssessment JSON produced by a deterministic rules engine. Rules: (1) Never add, change or estimate any amount, deadline or entitlement — use only what is in the JSON. (2) Amounts flagged VERIFY must be phrased "up to". (3) Lead with the single most important action. (4) Include every item from do_not. (5) Max 5 bullets, each under 22 words. (6) End with the disclaimer string provided in the JSON. Output the Explanation schema.`;

/** Every number a reader could act on must already exist in the assessment (raw or as a major-unit amount). */
export function allowedNumbers(a: RightsAssessment): Set<string> {
  const json = JSON.stringify(a);
  const allowed = new Set<string>();
  for (const m of json.matchAll(/\d+/g)) allowed.add(String(Number(m[0])));
  for (const m of json.matchAll(/"amountMinor":"(\d+)"/g)) {
    const minor = BigInt(m[1]!);
    allowed.add((minor / 100n).toString());
  }
  return allowed;
}

export function numbersIn(text: string): string[] {
  // "10,000.00" → "10000"; "€600" → "600"; decimals ".00" are ignored.
  return [...text.replace(/(\d),(?=\d{3}\b)/g, "$1").matchAll(/\d+(?:\.\d+)?/g)].map((m) =>
    String(Number(m[0]!.split(".")[0])),
  );
}

export function assertNumbersSupported(e: Explanation, a: RightsAssessment) {
  const allowed = allowedNumbers(a);
  const text = [e.headline, ...e.bullets, ...e.doNot].join(" ");
  const bad = numbersIn(text).filter((n) => !allowed.has(n));
  if (bad.length)
    throw new ServValidationError(`explanation contains numbers not in the assessment: ${bad.join(", ")}`);
}

export function rightsExplain(serv: ServClient, assessment: RightsAssessment): Promise<Explanation> {
  return serv.call("RightsExplain", {
    model: RIGHTS_EXPLAIN_MODEL,
    system: RIGHTS_EXPLAIN_SYSTEM,
    // Trusted input: produced by our own deterministic engine.
    user: `RightsAssessment JSON:\n${JSON.stringify(assessment)}`,
    schema: Explanation,
    postCheck: (e) => assertNumbersSupported(e, assessment),
  });
}
