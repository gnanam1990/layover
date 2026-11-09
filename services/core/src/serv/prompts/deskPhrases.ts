import { DeskPhrases, type RightsAssessment } from "@layover/shared";
import { ServValidationError, type ServClient } from "../client";
import { allowedNumbers, numbersIn } from "./rightsExplain";

export const DESK_PHRASES_MODEL = "gpt-5.4-mini";
export const DESK_PHRASES_SYSTEM = `You help a stranded traveler speak to an airline desk agent in the local language. Input: a target language and up to 4 short English points that were already checked against a rules engine. Rewrite them as polite, first-person requests the traveler can show or read out at the desk, e.g. "Please provide a hotel room for tonight." Rules: (1) Translate faithfully; never add, change or estimate an amount, deadline, flight number or entitlement. (2) Keep each phrase under 25 words. (3) Return the same number of phrases, in the same order, each with its English back-translation. Output the DeskPhrases schema.`;

/** SERV turns the checked desk points into phrases in the airport's language (numbers post-checked). */
export function deskPhrases(
  serv: ServClient,
  points: string[],
  language: string,
  assessment: RightsAssessment,
): Promise<DeskPhrases> {
  const check = (d: DeskPhrases) => {
    const allowed = allowedNumbers(assessment);
    const bad = numbersIn(d.phrases.map((p) => `${p.local} ${p.english}`).join(" ")).filter(
      (n) => !allowed.has(n),
    );
    if (bad.length)
      throw new ServValidationError(`desk phrases contain numbers not in the assessment: ${bad.join(", ")}`);
    if (d.phrases.length !== Math.min(points.length, 4))
      throw new ServValidationError("phrase count mismatch");
  };
  return serv.call("DeskPhrases", {
    model: DESK_PHRASES_MODEL,
    system: DESK_PHRASES_SYSTEM,
    // Trusted input: the points come from our own deterministic explanation.
    user: `Target language: ${language}\nPoints:\n${points
      .slice(0, 4)
      .map((p, i) => `${i + 1}. ${p}`)
      .join("\n")}`,
    schema: DeskPhrases,
    postCheck: check,
  });
}
