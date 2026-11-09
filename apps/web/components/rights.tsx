"use client";
import { useState } from "react";
import { formatMoney, type Entitlement, type RightsAssessment } from "@layover/shared";
import { Caption, Card } from "./ui";

const PACK_LABEL: Record<string, string> = {
  eu261: "EU261",
  uk261: "UK261",
  us_dot: "US DOT",
  in_dgca: "India DGCA",
};
const KIND: Record<string, { label: string; icon: string }> = {
  refund: { label: "Refund", icon: "↩" },
  reroute: { label: "Re-routing", icon: "✈" },
  compensation: { label: "Compensation", icon: "€" },
  care_meal: { label: "Meals while you wait", icon: "☕" },
  care_hotel: { label: "Hotel tonight", icon: "⌂" },
  care_transport: { label: "Transport to the hotel", icon: "⇄" },
};
const CONF: Record<string, string> = {
  HIGH: "bg-olive-50 text-olive-700",
  MEDIUM: "bg-sand text-brown-700",
  VERIFY: "border border-brown-700 text-brown-700",
};

export function DoNotBanner({ text, detail }: { text: string; detail?: string }) {
  return (
    <div role="alert" className="anim-in rounded-card border-l-4 border-amber-500 bg-white p-4 shadow-card">
      <p className="font-bold text-ink">{text}</p>
      {detail && <p className="t-small mt-1 text-ink-2">{detail}</p>}
    </div>
  );
}

function amount(e: Entitlement) {
  if (e.amount) return formatMoney(e.amount);
  if (e.amountUpTo) return `up to ${formatMoney(e.amountUpTo)}`;
  return "";
}

export function RightsPanel({ assessment }: { assessment: RightsAssessment }) {
  const [tab, setTab] = useState(0);
  const p = assessment.packs[tab];
  const versions = Object.entries(assessment.rulePackVersions)
    .map(([k, v]) => `${PACK_LABEL[k] ?? k} v${v}`)
    .join(", ");
  return (
    <Card aria-label="Your passenger rights">
      <Caption>Your rights</Caption>
      <div role="tablist" className="mt-2 flex flex-wrap gap-2">
        {assessment.packs.map((x, i) => (
          <button
            key={x.pack}
            role="tab"
            aria-selected={i === tab}
            onClick={() => setTab(i)}
            className={`rounded-pill px-3 py-1 text-[14px] font-medium ${i === tab ? "bg-ink text-white" : "border border-line-warm bg-white text-ink-2"}`}
          >
            {PACK_LABEL[x.pack] ?? x.pack}
          </button>
        ))}
      </div>
      {p && (
        <div role="tabpanel" className="mt-3">
          {p.why && <p className="t-small text-muted">{p.why}</p>}
          <ul className="mt-3 divide-y divide-line">
            {p.entitlements.map((e, i) => (
              <li key={i} className="flex flex-wrap items-center gap-3 py-2">
                <span aria-hidden className="w-5 text-center text-brown-700">
                  {KIND[e.kind]?.icon}
                </span>
                <span className="font-medium text-ink">{KIND[e.kind]?.label ?? e.kind}</span>
                {amount(e) && <span className="mono text-ink">{amount(e)}</span>}
                <span className={`rounded-pill px-2 py-0.5 text-[12px] font-medium ${CONF[e.confidence]}`}>
                  {e.confidence}
                </span>
                <a
                  href={e.sourceUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="t-small ml-auto text-olive-700 underline-offset-4 hover:underline"
                >
                  Source
                </a>
                <p className="t-small w-full pl-8 text-muted">{e.basis}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="t-small mt-3 text-muted">
        Not legal advice. Based on official rules as of {versions}. Amounts marked &lsquo;up to&rsquo; need
        confirming with the airline.
      </p>
    </Card>
  );
}
