"use client";
import { notFound } from "next/navigation";
import type { PolicyDecision, RightsAssessment, TimelineEvent, Trip } from "@layover/shared";
import { TopBar } from "../../../components/TopBar";
import { DecisionCard, SavingsBanner, SpendMeter, TripCard } from "../../../components/trip";
import { DoNotBanner, RightsPanel } from "../../../components/rights";
import { Timeline } from "../../../components/timeline";
import { PassportHandoff } from "../../../components/passport";
import { StatusChip } from "../../../components/ui";
import trip from "../../../../../packages/shared/fixtures/trip.json";
import decision from "../../../../../packages/shared/fixtures/policy-decision.json";

const usd = (d: number) => ({ amountMinor: String(d * 100), currency: "USD" as const });
const session = {
  id: "s",
  requestId: "r",
  maxPerTx: usd(120),
  maxTotal: usd(270),
  ttlUntilUtc: "2026-12-25T00:00:00Z",
  status: "active" as const,
  approvalUrl: "https://agentpassport.ai/agent-session/approve?token=demo",
};
const assessment: RightsAssessment = {
  flightId: "LH761",
  packs: [
    {
      pack: "eu261",
      applies: true,
      why: "Departs from FRA (EU).",
      entitlements: [
        {
          kind: "compensation",
          amount: { amountMinor: "60000", currency: "EUR" },
          confidence: "HIGH",
          basis: "EU261 Art. 7",
          sourceUrl: "https://eur-lex.europa.eu/eli/reg/2004/261/oj",
        },
        {
          kind: "care_hotel",
          confidence: "HIGH",
          basis: "EU261 Art. 9",
          sourceUrl: "https://eur-lex.europa.eu/eli/reg/2004/261/oj",
        },
      ],
      doNot: [],
      actions: [],
      evidenceNeeded: [],
    },
    {
      pack: "in_dgca",
      applies: true,
      entitlements: [
        {
          kind: "compensation",
          amountUpTo: { amountMinor: "1000000", currency: "INR" },
          confidence: "VERIFY",
          basis: "DGCA",
          sourceUrl: "https://www.dgca.gov.in",
        },
      ],
      doNot: [],
      actions: [],
      evidenceNeeded: [],
    },
  ],
  bestRemedy: "eu261",
  rulePackVersions: { eu261: "2026-11-09-s6" },
  disclaimer: "Not legal advice.",
};
const events: TimelineEvent[] = [
  {
    id: "1",
    tripId: "t",
    atUtc: "2026-12-20T19:31:00Z",
    type: "price_drop",
    simulated: true,
    title: "Hotel Lumen Goa is now $58.00",
  },
  {
    id: "2",
    tripId: "t",
    atUtc: "2026-12-20T19:31:05Z",
    type: "payment",
    simulated: false,
    title: "Paid $58.00 via Kite Passport",
    links: [{ label: "Payment on KiteScan", url: "https://testnet.kitescan.ai/tx/0xabc" }],
  },
];

/** Dev-only component gallery (M11 step 2). */
export default function Gallery() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <>
      <TopBar />
      <main className="mx-auto grid max-w-[1000px] gap-6 px-4 py-6">
        <div className="flex flex-wrap gap-2">
          <StatusChip kind="protected" dot>
            Protected
          </StatusChip>
          <StatusChip kind="watching">Watching</StatusChip>
          <StatusChip kind="action">Action needed</StatusChip>
          <StatusChip kind="error">Error</StatusChip>
          <StatusChip kind="simulated">Simulated</StatusChip>
        </div>
        <TripCard trip={trip as unknown as Trip} session={session} />
        <SpendMeter session={session} spent={usd(96)} />
        <SavingsBanner
          saving={usd(14)}
          fee={{ amountMinor: "420", currency: "USD" }}
          keep={{ amountMinor: "980", currency: "USD" }}
        />
        <DecisionCard
          decision={decision as PolicyDecision}
          title="Rebooked: same room, $14 cheaper"
          why="Same hotel, same dates."
        />
        <DoNotBanner text="Don't accept a voucher if you want your cash refund. Ask for the refund in writing." />
        <RightsPanel assessment={assessment} />
        <Timeline events={events} connected />
        <PassportHandoff session={{ ...session, status: "requested" }} priceScale={100} />
      </main>
    </>
  );
}
