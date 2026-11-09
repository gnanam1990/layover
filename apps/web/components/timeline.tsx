"use client";
import type { TimelineEvent } from "@layover/shared";
import { timeUtc } from "../lib/format";
import { ExtLink, StatusChip } from "./ui";

export function TimelineItem({ ev }: { ev: TimelineEvent }) {
  return (
    <li className="anim-in relative pl-6" data-type={ev.type}>
      <span
        aria-hidden
        className={`absolute left-0 top-1.5 h-2.5 w-2.5 rounded-full ${ev.simulated ? "border-2 border-amber-500 bg-transparent" : "bg-amber-500"}`}
      />
      <div className="flex flex-wrap items-center gap-2">
        <time className="mono t-small text-muted" dateTime={ev.atUtc}>
          {timeUtc(ev.atUtc)}
        </time>
        <span className={`font-medium ${ev.type === "error" ? "text-danger" : "text-ink"}`}>{ev.title}</span>
        {ev.simulated && <StatusChip kind="simulated">Simulated</StatusChip>}
      </div>
      {ev.detail && <p className="t-small text-ink-2">{ev.detail}</p>}
      {!!ev.links?.length && (
        <div className="mt-1 flex flex-wrap gap-2">
          {ev.links.map((l) =>
            l.url.startsWith("/") ? (
              <a
                key={l.url}
                href={l.url}
                className="t-small font-medium text-olive-700 underline-offset-4 hover:underline"
              >
                {l.label} →
              </a>
            ) : (
              <ExtLink key={l.url} href={l.url}>
                {l.label}
              </ExtLink>
            ),
          )}
        </div>
      )}
    </li>
  );
}

export function Timeline({
  events,
  connected,
  max,
}: {
  events: TimelineEvent[];
  connected?: boolean;
  max?: number;
}) {
  const list = [...events].reverse().slice(0, max);
  return (
    <section aria-label="Trip timeline" className="card p-5">
      <div className="flex items-center justify-between">
        <p className="t-caption text-muted">Timeline</p>
        {connected !== undefined && (
          <span className="t-small text-muted" aria-hidden>
            {connected ? "● live" : "○ reconnecting"}
          </span>
        )}
      </div>
      <ol
        aria-live="polite"
        className="relative mt-3 space-y-4 border-l border-line-warm pl-0 [&>li]:ml-[-5px]"
      >
        {list.length === 0 && (
          <li className="t-small text-muted">
            Nothing yet. Layover will log every check, decision and payment here.
          </li>
        )}
        {list.map((ev) => (
          <TimelineItem key={ev.id} ev={ev} />
        ))}
      </ol>
    </section>
  );
}
