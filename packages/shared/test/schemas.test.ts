import { describe, expect, test } from "bun:test";
import {
  NoticeFacts,
  PolicyDecision,
  Trip,
  TimelineEvent,
  RulePack,
  Money,
  RightsAssessment,
  TripDraft,
} from "../src/schemas";
import trip from "../fixtures/trip.json";
import notice from "../fixtures/notice-facts.json";
import decision from "../fixtures/policy-decision.json";
import { RULE_PACKS } from "../src/rules";

describe("fixtures validate", () => {
  test("trip", () => expect(Trip.safeParse(trip).success).toBe(true));
  test("notice facts", () => expect(NoticeFacts.safeParse(notice).success).toBe(true));
  test("policy decision", () => expect(PolicyDecision.safeParse(decision).success).toBe(true));
});

describe("rejections", () => {
  test("trip missing settings", () => {
    const { settings: _s, ...rest } = trip;
    expect(Trip.safeParse(rest).success).toBe(false);
  });
  test("trip with unknown status enum", () => {
    expect(Trip.safeParse({ ...trip, status: "flying" }).success).toBe(false);
  });
  test("notice facts with unknown reasonClass", () => {
    expect(NoticeFacts.safeParse({ ...notice, reasonClass: "aliens" }).success).toBe(false);
  });
  test("notice facts rejects extra keys (strict)", () => {
    expect(NoticeFacts.safeParse({ ...notice, sneaky: true }).success).toBe(false);
  });
  test("money rejects floats and unknown currency", () => {
    expect(Money.safeParse({ amountMinor: "72.5", currency: "USD" }).success).toBe(false);
    expect(Money.safeParse({ amountMinor: "72", currency: "JPY" }).success).toBe(false);
  });
  test("timeline event with unknown type", () => {
    const ev = {
      id: "e1",
      tripId: "t",
      atUtc: "2026-12-20T00:00:00Z",
      type: "party",
      simulated: false,
      title: "x",
    };
    expect(TimelineEvent.safeParse(ev).success).toBe(false);
    expect(TimelineEvent.safeParse({ ...ev, type: "payment" }).success).toBe(true);
  });
  test("policy decision missing checks", () => {
    const { checks: _c, ...rest } = decision;
    expect(PolicyDecision.safeParse(rest).success).toBe(false);
  });
  test("trip draft requires missing[]", () => {
    expect(TripDraft.safeParse({ travelerName: null, flights: [], hotels: [] }).success).toBe(false);
    expect(TripDraft.safeParse({ travelerName: null, flights: [], hotels: [], missing: [] }).success).toBe(
      true,
    );
  });
  test("rights assessment requires disclaimer", () => {
    expect(
      RightsAssessment.safeParse({ flightId: "f", packs: [], bestRemedy: "", rulePackVersions: {} }).success,
    ).toBe(false);
  });
});

describe("rule packs", () => {
  test("all four packs validate against the rule-pack schema", () => {
    expect(Object.keys(RULE_PACKS).sort()).toEqual(["eu261", "in_dgca", "uk261", "us_dot"]);
    for (const pack of Object.values(RULE_PACKS)) {
      const r = RulePack.safeParse(pack);
      if (!r.success) console.error(pack.id, r.error.issues);
      expect(r.success).toBe(true);
    }
  });
  test("eu261 bands are 250/400/600 EUR", () => {
    expect(RULE_PACKS.eu261.bands?.map((b) => b.amount)).toEqual([250, 400, 600]);
  });
  test("every entry has a source", () => {
    for (const pack of Object.values(RULE_PACKS))
      for (const e of pack.entries) expect(e.source.length).toBeGreaterThan(0);
  });
});
