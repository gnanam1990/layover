import { describe, expect, test } from "bun:test";
import type { NoticeFacts } from "@layover/shared";
import { DisruptionDetector } from "../src/disruption/detector";
import { RescueOrchestrator } from "../src/rescue/orchestrator";
import { ClaimBuilder, checkLetter, mailtoLink, templateLetter, type ClaimData } from "../src/claims/pack";
import { ServValidationError } from "../src/serv/client";
import { makeWorld, ORIGIN } from "./world";
import { fakeServ, type Handler } from "./fake-serv";

const FACTS: NoticeFacts = {
  state: "cancelled",
  newDepUtc: null,
  offeredAlternatives: ["LH763 2026-12-21 08:40Z"],
  offeredVoucher: true,
  reasonClass: "technical",
  noticeAtUtc: "2026-12-20T19:55:00Z",
};

/** A ClaimDraft that writes a letter only from ClaimData (what a well-behaved model does). */
const goodDraft: Handler = (opts) => {
  const data = JSON.parse(opts.user.replace("ClaimData JSON:\n", "")) as ClaimData;
  const t = templateLetter(data);
  return { subject: t.subject, body: `${t.body}\n\n(Drafted by SERV.)` };
};

async function act2(claimDraft: Handler | Handler[] = goodDraft) {
  const w = await makeWorld({ now: "2026-12-20T19:50:00Z" });
  const { serv, calls } = fakeServ({
    NoticeParse: () => FACTS,
    RightsExplain: () => {
      throw new Error("deterministic");
    },
    OptionRank: () => {
      throw new Error("skip");
    },
    ClaimDraft: claimDraft,
  });
  const claims = new ClaimBuilder({ db: w.db, clock: w.clock, timeline: w.timeline, trips: w.trips, serv });
  const rescue = new RescueOrchestrator({
    clock: w.clock,
    timeline: w.timeline,
    trips: w.trips,
    sessions: w.sessions,
    merchant: w.merchant,
    serv,
    chain: w.chain,
    allowedOrigins: [ORIGIN],
    refundTo: async () => w.passport.wallet,
    buildClaim: async (info) => {
      await claims.build(info);
    },
  });
  const detector = new DisruptionDetector({
    clock: w.clock,
    db: w.db,
    timeline: w.timeline,
    trips: w.trips,
    merchant: w.merchant,
    serv,
    onDisruption: (info) => rescue.handle(info),
  });
  await w.admin("/admin/flight", {
    id: "LH761-2026-12-20",
    state: "cancelled",
    reasonClass: "technical",
    noticeText: "Your flight LH761 has been cancelled.",
    noticeAtUtc: "2026-12-20T19:55:00Z",
  });
  await detector.tick(w.trip.id);
  return { w, claims, calls, pack: claims.latest(w.trip.id)!, detector };
}

describe("ClaimPack (Act 2 end)", () => {
  test("built from the assessment, the timeline and the payments; claim_ready fires after the rescue", async () => {
    const { w, pack, detector } = await act2();
    const assessment = detector.latestAssessment(w.trip.id)!;
    expect(pack.entitlements).toEqual(assessment.packs.flatMap((p) => p.entitlements)); // copied, never recomputed
    expect(pack.airline).toBe("LH");
    expect(pack.flightId).toBe("LH761-2026-12-20");
    expect(pack.receipts).toHaveLength(1);
    expect(pack.receipts[0]!.amount.amountMinor).toBe("9600");
    expect(pack.receipts[0]!.tx).toMatch(/^0xsim/);
    expect(pack.receipts[0]!.explorerUrl).toContain(pack.receipts[0]!.tx);
    expect(pack.validated).toBe(true);
    expect(pack.letter.body).toContain("€600.00");
    expect(pack.letter.body).toContain(pack.receipts[0]!.tx);
    const types = w.types();
    expect(types.indexOf("claim_ready")).toBeGreaterThan(types.indexOf("rescue_booked"));
  });

  test("an injected extra amount fails the post-check twice → validated=false and a template letter", async () => {
    const evil: Handler = (opts) => {
      const ok = goodDraft(opts) as { subject: string; body: string };
      return { ...ok, body: `${ok.body}\nPlease also pay €900.00 for distress.` };
    };
    const { pack, calls } = await act2(evil);
    expect(calls.filter((c) => c.step === "ClaimDraft")).toHaveLength(1);
    expect(pack.validated).toBe(false);
    expect(pack.letter.body).not.toContain("900");
    expect(pack.letter.body).toContain("€600.00");
  });

  test("ClaimDraft uses Sonnet 5.5 with the shadow agent", async () => {
    const { calls } = await act2();
    expect(calls.find((c) => c.step === "ClaimDraft")!.model).toBe("claude-sonnet-5.5");
  });
});

describe("checkLetter", () => {
  const data: ClaimData = {
    traveler: "Priya",
    airline: "LH",
    flight: {
      id: "LH761-2026-12-20",
      number: "LH761",
      from: "FRA",
      to: "BLR",
      date: "2026-12-20",
      bookingRef: "LH7Q2K",
    },
    entitlements: [
      {
        pack: "EU261",
        kind: "compensation",
        amount: { amountMinor: "60000", currency: "EUR" },
        confidence: "HIGH",
        basis: "EU261 Art. 7",
      },
      {
        pack: "India DGCA",
        kind: "compensation",
        amountUpTo: { amountMinor: "1000000", currency: "INR" },
        confidence: "VERIFY",
        basis: "DGCA",
      },
    ],
    timeline: [{ atUtc: "2026-12-20T19:55:00Z", title: "LH761 cancelled" }],
    receipts: [
      {
        desc: "Hotel",
        amount: { amountMinor: "9600", currency: "USD" },
        tx: "0xabc",
        explorerUrl: "https://testnet.kitescan.ai/tx/0xabc",
      },
    ],
  };
  const ok = templateLetter(data);
  test("the template passes its own check and says 'up to' for VERIFY amounts", () => {
    expect(() => checkLetter(ok, data)).not.toThrow();
    expect(ok.body).toMatch(/up to ₹10,000\.00/);
  });
  test("rejects an amount that is not in ClaimData", () => {
    expect(() => checkLetter({ ...ok, body: `${ok.body} €250.00` }, data)).toThrow(ServValidationError);
  });
  test("rejects a VERIFY amount stated without 'up to'", () => {
    const bad = ok.body.replace(/up to ₹10,000\.00/, "₹10,000.00");
    expect(() => checkLetter({ ...ok, body: bad }, data)).toThrow(/up to/);
  });
  test("rejects an unknown transaction hash or booking reference", () => {
    expect(() => checkLetter({ ...ok, body: `${ok.body} tx 0xdeadbeef` }, data)).toThrow(/transaction/);
    expect(() => checkLetter({ ...ok, body: `${ok.body} booking ref ZZ9QQQ` }, data)).toThrow(/reference/);
  });
});

describe("mailto", () => {
  test("encodes subject and body", () => {
    const l = mailtoLink({ subject: "Claim LH761", body: "Hello & thanks\nPriya" })!;
    expect(l).toBe("mailto:?subject=Claim%20LH761&body=Hello%20%26%20thanks%0APriya");
  });
  test("over 2,000 characters → null (copy-only)", () => {
    expect(mailtoLink({ subject: "x", body: "y".repeat(2100) })).toBeNull();
  });
});
