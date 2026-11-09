"use client";
import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  formatMoney,
  type Money,
  type PolicyDecision,
  type TimelineEvent,
  type TripSettings,
} from "@layover/shared";
import { api, ApiError, type TripDetail } from "../../../lib/api";
import { useTimeline } from "../../../lib/sse";
import { claimValueText, limitsSentence, money } from "../../../lib/format";
import { TopBar, useHealth } from "../../../components/TopBar";
import { AgentCard, DecisionCard, SavingsBanner, SpendMeter, TripCard } from "../../../components/trip";
import { DoNotBanner, RightsPanel } from "../../../components/rights";
import { Timeline } from "../../../components/timeline";
import { PassportHandoff } from "../../../components/passport";
import { DemoPanel } from "../../../components/DemoPanel";
import { Caption, Card, ExtLink, Skeleton, StatusChip } from "../../../components/ui";

const usd = (dollars: number): Money => ({ amountMinor: String(Math.round(dollars * 100)), currency: "USD" });
const last = (events: TimelineEvent[], type: TimelineEvent["type"]) =>
  [...events].reverse().find((e) => e.type === type);

export default function TripPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const health = useHealth();
  const { events, connected } = useTimeline(id);
  const [detail, setDetail] = useState<TripDetail | null>(null);
  const [notFound, setNotFound] = useState(false);

  const refresh = useCallback(() => {
    api
      .trip(id)
      .then(setDetail)
      .catch((e) => e instanceof ApiError && e.status === 404 && setNotFound(true));
  }, [id]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(refresh, 120);
  }, [events.length, refresh]);

  if (notFound) {
    return (
      <>
        <TopBar />
        <main className="mx-auto max-w-[1200px] px-4 py-10">
          <p>
            Trip not found.{" "}
            <Link href="/" className="text-olive-700 underline">
              Back to trips
            </Link>
          </p>
        </main>
      </>
    );
  }
  if (!detail) {
    return (
      <>
        <TopBar />
        <main className="mx-auto grid max-w-[1200px] gap-4 px-4 py-6">
          <Skeleton className="h-40" />
          <Skeleton className="h-64" />
        </main>
      </>
    );
  }

  const isProtected = detail.trip.status === "protected" || detail.session?.status === "active";
  return (
    <>
      <TopBar protectedTrip={isProtected} />
      <main className="mx-auto max-w-[1200px] px-4 pb-32 pt-6">
        {isProtected ? (
          <Dashboard detail={detail} events={events} connected={connected} onRefresh={refresh} />
        ) : (
          <Protect
            detail={detail}
            events={events}
            priceScale={health?.priceScale ?? 100}
            fakePayer={health?.payer === "fake"}
            needsLogin={health?.payer === "passport" && health.passport.loggedIn === false}
            onRefresh={refresh}
          />
        )}
      </main>
      {health?.demoMode && <DemoPanel />}
    </>
  );
}

// ---------------- S2 Protect ----------------
function Protect({
  detail,
  events,
  priceScale,
  fakePayer,
  needsLogin,
  onRefresh,
}: {
  detail: TripDetail;
  events: TimelineEvent[];
  priceScale: number;
  fakePayer: boolean;
  needsLogin: boolean;
  onRefresh: () => void;
}) {
  const s = detail.trip.settings;
  const [autoRebook, setAutoRebook] = useState(s.autoRebook);
  const [minSaving, setMinSaving] = useState(Number(s.minSaving.amountMinor) / 100);
  const [autoRescue, setAutoRescue] = useState(s.autoRescue);
  const [budget, setBudget] = useState(Number(s.emergencyBudget.amountMinor) / 100);
  const [perBooking, setPerBooking] = useState(Number(s.maxPerBooking.amountMinor) / 100);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const until = useMemo(() => {
    const dates = [
      ...detail.trip.hotelBookings.map((b) => b.checkOut),
      ...detail.trip.flights.map((f) => f.schedArrUtc.slice(0, 10)),
    ].sort();
    const d = new Date(`${dates.at(-1) ?? new Date().toISOString().slice(0, 10)}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString();
  }, [detail.trip]);

  const invalid = !(perBooking >= 1)
    ? "Max per booking must be at least $1."
    : !(budget >= 0)
      ? "Emergency budget can't be negative."
      : !(minSaving >= 0)
        ? "Minimum saving can't be negative."
        : null;
  const session = detail.session;
  const rejected = session?.status === "rejected";
  const capError = last(events, "error");

  async function protect() {
    setBusy(true);
    setError(null);
    const settings: Partial<TripSettings> = {
      autoRebook,
      minSaving: usd(minSaving),
      autoRescue,
      emergencyBudget: usd(budget),
      maxPerBooking: usd(perBooking),
    };
    try {
      await api.protect(detail.trip.id, settings);
      onRefresh();
    } catch (e) {
      // The sign-in banner already says this; don't repeat it as an error.
      if (e instanceof ApiError && e.body.error === "not_logged_in" && needsLogin) return;
      setError(e instanceof ApiError ? (e.body.userMessage ?? e.message) : "Couldn't reach Kite Passport.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-12">
      <div className="grid gap-6 lg:col-span-8">
        <TripCard trip={detail.trip} session={session} />
        {session?.status === "requested" ? (
          <PassportHandoff
            session={session}
            priceScale={priceScale}
            {...(fakePayer && {
              onSimulateApprove: () => void api.demo.approve(detail.trip.id).then(onRefresh),
            })}
          />
        ) : (
          <Card aria-label="Set your limits">
            <Caption>Set your limits once</Caption>
            <h2 className="t-h2 mt-1">Protect my trip</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  aria-label="Auto-rebook when the price drops"
                  checked={autoRebook}
                  onChange={(e) => setAutoRebook(e.target.checked)}
                  className="h-4 w-4 accent-[var(--olive-700)]"
                />
                <span>
                  Auto-rebook when I save at least
                  <input
                    aria-label="Minimum saving in dollars"
                    type="number"
                    min={1}
                    value={minSaving}
                    onChange={(e) => setMinSaving(Number(e.target.value))}
                    className="input mono ml-2 inline w-20 py-1"
                  />
                </span>
              </label>
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  aria-label="Auto-rescue: book a hotel if my flight breaks"
                  checked={autoRescue}
                  onChange={(e) => setAutoRescue(e.target.checked)}
                  className="h-4 w-4 accent-[var(--olive-700)]"
                />
                <span>Auto-rescue (book a hotel if my flight breaks)</span>
              </label>
              <label>
                <span className="t-small text-muted">Emergency budget ($)</span>
                <input
                  type="number"
                  aria-label="Emergency budget in dollars"
                  min={0}
                  value={budget}
                  onChange={(e) => setBudget(Number(e.target.value))}
                  className="input mono mt-1"
                />
              </label>
              <label>
                <span className="t-small text-muted">Max per booking ($)</span>
                <input
                  type="number"
                  aria-label="Max per booking in dollars"
                  min={1}
                  value={perBooking}
                  onChange={(e) => setPerBooking(Number(e.target.value))}
                  className="input mono mt-1"
                />
              </label>
            </div>
            <p className="mt-4 text-ink" aria-live="polite">
              {limitsSentence(usd(budget + perBooking), usd(perBooking), until)}
            </p>
            {needsLogin && (
              <div role="alert" className="mt-4 rounded-input bg-[#FFF4E5] p-3 text-warn">
                Sign in to Kite Passport first:{" "}
                <code className="mono">kpass login init --email you@example.com</code>
              </div>
            )}
            {rejected && (
              <p role="alert" className="mt-4 text-danger">
                Approval declined. Nothing can be spent.
              </p>
            )}
            {error && (
              <p role="alert" className="mt-4 text-danger">
                {error}
              </p>
            )}
            {capError?.data && typeof capError.data === "object" && "code" in capError.data && (
              <p className="mt-4 text-warn">
                This needs more than your trip budget allows. Approve a bigger budget?
              </p>
            )}
            {invalid && (
              <p role="alert" className="mt-4 text-danger">
                {invalid}
              </p>
            )}
            <button className="btn btn-primary mt-5" disabled={busy || !!invalid} onClick={protect}>
              Protect my trip
            </button>
          </Card>
        )}
      </div>
      <div className="grid content-start gap-6 lg:col-span-4">
        <Timeline events={events} />
      </div>
    </div>
  );
}

// ---------------- S3 Dashboard + S4 Rescue mode ----------------
function Dashboard({
  detail,
  events,
  connected,
  onRefresh,
}: {
  detail: TripDetail;
  events: TimelineEvent[];
  connected: boolean;
  onRefresh: () => void;
}) {
  const disruption = last(events, "disruption");
  const decisionEv = last(events, "policy_decision");
  const refund = last(events, "refund_verified");
  const capError = [...events].reverse().find((e) => e.type === "error" && e.data && "code" in e.data);
  const savings = refund?.data as { saving: Money; fee: Money; keep: Money; refunded?: Money } | undefined;
  const rebooked = last(events, "booking_confirmed");
  const drop = last(events, "price_drop");
  const dropOffer = (
    drop?.data as { offer?: { hotelName: string; price: Money; hotelId: string } } | undefined
  )?.offer;

  return (
    <>
      {disruption && (
        <RescueBand detail={detail} events={events} disruption={disruption} onRefresh={onRefresh} />
      )}
      <div className="grid gap-6 lg:grid-cols-12">
        <div className="grid content-start gap-6 lg:col-span-8">
          <p className="text-ink" aria-live="polite">
            <StatusChip kind="protected" dot>
              Protected
            </StatusChip>{" "}
            <span className="t-small">Protected · Layover is watching prices and your flight.</span>
          </p>
          <TripCard trip={detail.trip} session={detail.session} />
          {savings && (
            <>
              <SavingsBanner saving={savings.saving} fee={savings.fee} keep={savings.keep} />
              <p className="text-ink-2">
                Rebooked. Your old booking was cancelled and {money(savings.refunded)} came back to your
                wallet.
              </p>
            </>
          )}
          {decisionEv?.data && !disruption && (
            <DecisionCard
              decision={decisionEv.data as unknown as PolicyDecision}
              title={
                (decisionEv.data as unknown as PolicyDecision).allow && dropOffer
                  ? `${dropOffer.hotelName.replace("Hotel ", "Hotel ")} dropped to ${formatMoney(dropOffer.price)}. Same room, same dates.`
                  : (decisionEv.data as unknown as PolicyDecision).reasons.join() === "consent" && dropOffer
                    ? `${dropOffer.hotelName} dropped to ${formatMoney(dropOffer.price)}. Waiting for your tap to rebook.`
                    : decisionEv.title
              }
            />
          )}
          {rebooked && !savings && !disruption && <p className="t-small text-muted">{rebooked.title}</p>}
          {capError && (
            <Card>
              <p className="text-warn">
                This needs more than your trip budget allows. Approve a bigger budget?
              </p>
              <p className="t-small mt-1 text-muted">{capError.detail}</p>
            </Card>
          )}
          {detail.pendingRebook.map((p) => (
            <Card key={p.bookingId}>
              <p className="text-ink">
                {p.offer.hotelName} dropped to {money(p.offer.price)}. Same room, same dates.
              </p>
              <button
                className="btn btn-primary mt-3"
                onClick={() => void api.confirmRebook(detail.trip.id, p.bookingId).then(onRefresh)}
              >
                Rebook for {money(p.offer.price)}
              </button>
            </Card>
          ))}
          {detail.rights && !disruption && <RightsPanel assessment={detail.rights.assessment} />}
        </div>
        <div className="grid content-start gap-6 lg:col-span-4">
          <SpendMeter session={detail.session} spent={detail.spent} />
          <AgentCard session={detail.session} />
          <Timeline events={events} connected={connected} max={40} />
          <Link
            href={`/trips/${detail.trip.id}/timeline`}
            className="t-small font-medium text-olive-700 underline-offset-4 hover:underline"
          >
            Full timeline →
          </Link>
        </div>
      </div>
    </>
  );
}

function RescueBand({
  detail,
  events,
  disruption,
  onRefresh,
}: {
  detail: TripDetail;
  events: TimelineEvent[];
  disruption: TimelineEvent;
  onRefresh: () => void;
}) {
  const flight =
    detail.trip.flights.find(
      (f) => f.id === (disruption.data as { flightId?: string } | undefined)?.flightId,
    ) ?? detail.trip.flights[0];
  const code = flight ? `${flight.carrier}${flight.number}` : "Your flight";
  const state = flight?.status?.state === "cancelled" ? "cancelled" : "badly delayed";
  const vw = last(events, "voucher_warning");
  const booked = last(events, "rescue_booked");
  const noHotel = [...events]
    .reverse()
    .find((e) => e.type === "error" && e.title === "No hotel within your limits");
  const claim = last(events, "claim_ready");
  const receipt = (
    booked?.data as { receipt?: { tx: string; explorerUrl: string; amount: Money } } | undefined
  )?.receipt;
  const eu = detail.rights?.assessment.packs.find(
    (p) => p.pack === "eu261" && p.entitlements.some((e) => e.kind === "care_hotel"),
  );
  const desk = detail.rights?.explanation.bullets.slice(0, 3) ?? [];
  const local = detail.rights?.desk;

  return (
    <section aria-label="Rescue mode" className="mb-6 grid gap-4">
      <div role="alert" className="anim-in rounded-panel bg-danger px-5 py-4 text-white">
        <p className="text-[20px] font-medium">
          {code} is {state}. You&apos;re covered.
        </p>
      </div>
      {/* Fixed order (UI spec S4): 1 DoNot → 2 Tonight → 3 Rights → 4 Desk → 5 Claim */}
      {vw && <DoNotBanner text={vw.title} detail={vw.detail} />}
      <Card aria-label="Tonight">
        <Caption>Tonight</Caption>
        {booked ? (
          <>
            <p className="t-h2 mt-1">{booked.title}</p>
            <p className="t-small mt-1 text-ink-2">{booked.detail}</p>
            {receipt && (
              <p className="mt-2 flex flex-wrap items-center gap-2">
                <span className="mono">{money(receipt.amount)}</span> paid via Kite Passport
                {receipt.explorerUrl && <ExtLink href={receipt.explorerUrl}>Receipt tx</ExtLink>}
              </p>
            )}
            {eu && (
              <p className="t-small mt-3 text-ink-2">
                The airline owes you a hotel tonight. If the desk can&apos;t give one, we&apos;ve booked it,
                so keep this receipt to claim it back.
              </p>
            )}
          </>
        ) : detail.pendingRescue?.options.length ? (
          <>
            <p className="mt-1 text-ink">
              {detail.pendingRescue.options[0]!.hotelName}, {detail.pendingRescue.options[0]!.distanceKm} km
              from the airport, {money(detail.pendingRescue.options[0]!.price)}.
            </p>
            <button
              className="btn btn-primary mt-3"
              onClick={() =>
                void api
                  .confirmRescue(detail.trip.id, detail.pendingRescue!.options[0]!.hotelId)
                  .then(onRefresh)
              }
            >
              Book it for {money(detail.pendingRescue.options[0]!.price)}
            </button>
          </>
        ) : noHotel ? (
          <p className="mt-1 text-warn">{noHotel.detail}</p>
        ) : (
          <p className="mt-1 text-muted">Finding a hotel near the airport…</p>
        )}
      </Card>
      {detail.rights && <RightsPanel assessment={detail.rights.assessment} />}
      {desk.length > 0 && (
        <Card aria-label="What to say at the desk">
          <Caption>What to say at the desk</Caption>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-ink-2">
            {desk.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
          {local && local.phrases.length > 0 && (
            <div className="mt-4 rounded-input bg-paper-2 p-3">
              <p className="t-caption text-muted">Show the desk ({local.language})</p>
              <ul className="mt-2 space-y-2">
                {local.phrases.map((ph) => (
                  <li key={ph.local}>
                    <p className="text-[18px] leading-7 text-ink">{ph.local}</p>
                    <p className="t-small text-muted">{ph.english}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      )}
      {claim && (
        <Card>
          <p className="flex flex-wrap items-center gap-3">
            <span className="font-medium text-ink">{claim.title}</span>
            {detail.claim && claimValueText(detail.claim.pack) && (
              <span className="mono t-small text-brown-700">{claimValueText(detail.claim.pack)}</span>
            )}
            <Link className="btn btn-primary" href={`/trips/${detail.trip.id}/claim`}>
              Open claim →
            </Link>
          </p>
        </Card>
      )}
    </section>
  );
}
