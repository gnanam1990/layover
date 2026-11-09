"use client";
import { use, useState } from "react";
import Link from "next/link";
import type { TimelineEvent } from "@layover/shared";
import { useTimeline } from "../../../../lib/sse";
import { TopBar } from "../../../../components/TopBar";
import { Timeline } from "../../../../components/timeline";

const FILTERS: Record<string, (e: TimelineEvent) => boolean> = {
  All: () => true,
  Money: (e) =>
    [
      "payment",
      "refund_verified",
      "cancel_requested",
      "booking_confirmed",
      "rescue_booked",
      "session_active",
    ].includes(e.type),
  Rights: (e) =>
    ["disruption", "rights_assessed", "voucher_warning", "claim_ready", "flight_status"].includes(e.type),
  Simulated: (e) => e.simulated,
};

export default function TimelinePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { events, connected } = useTimeline(id);
  const [f, setF] = useState("All");
  return (
    <>
      <TopBar />
      <main className="mx-auto grid max-w-[900px] gap-4 px-4 pb-24 pt-6">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="t-h1">Timeline</h1>
          <Link href={`/trips/${id}`} className="t-small text-olive-700 underline-offset-4 hover:underline">
            ← Back to trip
          </Link>
        </div>
        <div role="group" aria-label="Filter" className="flex flex-wrap gap-2">
          {Object.keys(FILTERS).map((k) => (
            <button
              key={k}
              aria-pressed={f === k}
              onClick={() => setF(k)}
              className={`rounded-pill px-3 py-1 text-[14px] font-medium ${f === k ? "bg-ink text-white" : "border border-line-warm bg-white text-ink-2"}`}
            >
              {k}
            </button>
          ))}
        </div>
        <Timeline events={events.filter(FILTERS[f]!)} connected={connected} />
      </main>
    </>
  );
}
