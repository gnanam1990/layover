"use client";
import Link from "next/link";
import type { Money, PolicyDecision, SessionRecord, Trip } from "@layover/shared";
import { dateShort, dateTime, money } from "../lib/format";
import { Caption, Card, StatusChip } from "./ui";
import { useHealth } from "./TopBar";

export function TripCard({
  trip,
  session,
  href,
}: {
  trip: Trip;
  session?: SessionRecord | null;
  href?: string;
}) {
  const active = trip.hotelBookings.filter((b) => b.status === "active");
  const body = (
    <Card className="anim-in">
      <div className="flex items-center justify-between gap-3">
        <Caption>{trip.travelerName}&apos;s trip</Caption>
        {trip.status === "protected" ? (
          <StatusChip kind="protected" dot>
            Protected
          </StatusChip>
        ) : session?.status === "requested" ? (
          <StatusChip kind="action">Waiting for passkey</StatusChip>
        ) : (
          <StatusChip kind="watching">Not protected yet</StatusChip>
        )}
      </div>
      <ul className="mt-3 divide-y divide-line">
        {trip.flights.map((f) => (
          <li key={f.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2">
            <span className="mono font-medium text-ink">
              {f.carrier}
              {f.number}
            </span>
            <span className="text-ink-2">
              {f.from} → {f.to}
            </span>
            <span className="t-small text-muted">{dateTime(f.schedDepUtc)}</span>
            <FlightStatusChip state={f.status?.state ?? "scheduled"} delay={f.status?.depDelayMin ?? 0} />
          </li>
        ))}
        {active.map((h) => (
          <li key={h.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2">
            <span className="font-medium text-ink">{h.hotelName}</span>
            <span className="t-small text-muted">
              {dateShort(h.checkIn)} – {dateShort(h.checkOut)}
            </span>
            <span className="mono text-ink">{money(h.price)}</span>
            {h.refundable && <StatusChip kind="neutral">Free cancellation</StatusChip>}
            {h.confirmation && <span className="mono t-small text-muted">{h.confirmation}</span>}
          </li>
        ))}
      </ul>
    </Card>
  );
  return href ? (
    <Link href={href} className="block rounded-card focus-visible:outline-2">
      {body}
    </Link>
  ) : (
    body
  );
}

function FlightStatusChip({ state, delay }: { state: string; delay: number }) {
  if (state === "cancelled") return <StatusChip kind="error">Cancelled</StatusChip>;
  if (state === "delayed" || delay > 0) return <StatusChip kind="action">Delayed +{delay} min</StatusChip>;
  return <StatusChip kind="neutral">{state === "scheduled" ? "On time" : state}</StatusChip>;
}

export function SpendMeter({ session, spent }: { session: SessionRecord | null; spent: Money }) {
  if (!session) return null;
  const total = Number(session.maxTotal.amountMinor);
  const used = Number(spent.amountMinor);
  const tick = Number(session.maxPerTx.amountMinor);
  const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0;
  return (
    <Card aria-label="Trip budget">
      <Caption>Trip budget</Caption>
      <div
        className="relative mt-3 h-2 w-full rounded-pill bg-sand"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={used}
        aria-label={`${money(spent)} of ${money(session.maxTotal)} used`}
      >
        <div
          className="h-2 rounded-pill bg-olive-700 transition-[width] duration-200"
          style={{ width: `${pct}%` }}
        />
        <span
          aria-hidden
          className="absolute -top-1 h-4 w-px bg-brown-700"
          style={{ left: `${Math.min(100, (tick / total) * 100)}%` }}
        />
      </div>
      <p className="t-small mt-3 text-ink-2">
        Trip budget · <span className="mono">{money(spent)}</span> of{" "}
        <span className="mono">{money(session.maxTotal)}</span> used · max{" "}
        <span className="mono">{money(session.maxPerTx)}</span> per booking
      </p>
      <p className="t-small mt-1 text-muted">
        Kite session {session.status} · until {dateTime(session.ttlUntilUtc)}
      </p>
    </Card>
  );
}

export function SavingsBanner({ saving, fee, keep }: { saving: Money; fee: Money; keep: Money }) {
  return (
    <Card className="anim-in" aria-live="polite">
      <Caption>Price-drop rebook</Caption>
      <p className="t-display mt-2">
        Saved <span className="mono border-b-4 border-amber-500">{money(saving)}</span>
      </p>
      <p className="mt-2 text-ink-2">
        Saved {money(saving)} · our fee {money(fee)} · you keep {money(keep)}
      </p>
    </Card>
  );
}

export function DecisionCard({
  decision,
  title,
  why,
}: {
  decision: PolicyDecision;
  title: string;
  why?: string;
}) {
  return (
    <Card className="anim-in">
      <Caption>Policy decision</Caption>
      <h3 className="t-h2 mt-1">{title}</h3>
      <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
        {decision.checks.map((c) => (
          <li key={c.name} className="t-small flex items-start gap-2">
            <span
              aria-label={c.pass ? "passed" : "failed"}
              className={c.pass ? "text-olive-700" : "text-danger"}
            >
              {c.pass ? "✓" : "✕"}
            </span>
            <span>
              <span className="font-medium text-ink">{c.name.replaceAll("_", " ")}</span>{" "}
              <span className="text-muted">{c.detail}</span>
            </span>
          </li>
        ))}
      </ul>
      {why && <p className="t-small mt-3 text-muted">Why: {why}</p>}
    </Card>
  );
}

/** "Who's acting for you": the verifiable identity and limits behind every payment (Kite track). */
export function AgentCard({ session }: { session: SessionRecord | null }) {
  const h = useHealth();
  if (!h) return null;
  const p = h.passport;
  const identity =
    h.payer === "passport"
      ? "Kite Agent Passport"
      : h.payer === "direct"
        ? "Direct x402 key (testnet)"
        : "Fake payer (offline)";
  return (
    <Card aria-label="Who's acting for you">
      <Caption>Who&apos;s acting for you</Caption>
      <dl className="t-small mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
        <dt className="text-muted">Agent</dt>
        <dd className="text-ink">
          Layover{" "}
          {p.agent ? (
            <span className="mono">({p.agent.id})</span>
          ) : (
            <span className="text-muted">(registers on first approval)</span>
          )}
        </dd>
        <dt className="text-muted">Identity</dt>
        <dd className="text-ink">{identity}</dd>
        <dt className="text-muted">For</dt>
        <dd className="text-ink">{p.email ?? "—"}</dd>
        <dt className="text-muted">Wallet</dt>
        <dd className="mono text-ink">{p.wallet ? `${p.wallet.slice(0, 6)}…${p.wallet.slice(-4)}` : "—"}</dd>
        <dt className="text-muted">Can spend</dt>
        <dd className="text-ink">
          {session ? (
            <>
              <span className="mono">{money(session.maxPerTx)}</span> per booking ·{" "}
              <span className="mono">{money(session.maxTotal)}</span> total
            </>
          ) : (
            "nothing until you approve a session"
          )}
        </dd>
        <dt className="text-muted">Until</dt>
        <dd className="text-ink">{session ? dateTime(session.ttlUntilUtc) : "—"}</dd>
      </dl>
      <p className="t-small mt-2 text-muted">
        Every payment is checked by Layover&apos;s policy gate and capped by Kite.
      </p>
    </Card>
  );
}
