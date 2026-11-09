"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { SessionRecord, Trip } from "@layover/shared";
import { api, ApiError } from "../lib/api";
import { TopBar, useHealth } from "../components/TopBar";
import { TripCard } from "../components/trip";
import { Skeleton, StatusChip } from "../components/ui";

const EXAMPLES = [
  "I'm Priya. LH761 FRA→BLR Dec 20, hotel booking HX-2231 at Hotel Lumen Goa Dec 22–24",
  "I'm Marcus. UA1782 SFO→JFK Dec 20",
  "I'm Priya. Hotel Lumen Goa HX-2231 Dec 22–24",
];

export default function Home() {
  const router = useRouter();
  const health = useHealth();
  const [text, setText] = useState("");
  const [emailMode, setEmailMode] = useState(false);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [missing, setMissing] = useState<string[]>([]);
  const [answer, setAnswer] = useState("");
  const [trips, setTrips] = useState<{ trip: Trip; session: SessionRecord | null }[] | null>(null);

  useEffect(() => {
    api
      .trips()
      .then(setTrips)
      .catch(() => setTrips([]));
  }, []);

  async function submit(input = text) {
    if (input.trim().length < 3) return;
    setState("loading");
    setMissing([]);
    try {
      const r = await api.intake(input);
      if (r.trip) {
        await api.saveTrip(r.trip);
        router.push(`/trips/${r.trip.id}`);
        return;
      }
      setMissing(r.missing);
      setState("idle");
    } catch (e) {
      setState("error");
      if (e instanceof ApiError && e.status === 502) setMissing([]);
    }
  }

  async function answerMissing() {
    const next = `${text}\n${answer}`;
    setText(next);
    setAnswer("");
    await submit(next);
  }

  async function demoTrip() {
    const r = await api.demo.seed();
    router.push(`/trips/${r.trip.id}`);
  }

  return (
    <>
      <TopBar />
      <main className="mx-auto max-w-[1200px] px-4 pb-24">
        <section className="relative mt-8 overflow-hidden rounded-panel px-2 py-10 sm:px-8">
          <div aria-hidden className="dot-grid pointer-events-none absolute right-0 top-0 h-full w-2/3" />
          <h1 className="t-h1 relative sm:text-[56px] sm:leading-[60px]">Your trip&apos;s guardian.</h1>
          <p className="relative mt-2 max-w-xl text-[18px] text-ink-2">
            Saves money before you fly. Rescues you when it breaks.
          </p>

          <div className="relative mt-8 max-w-2xl">
            <label htmlFor="trip-text" className="t-caption text-muted">
              {emailMode ? "Paste your confirmation email" : "Tell me about your trip"}
            </label>
            <textarea
              id="trip-text"
              className="input mt-2 min-h-[120px] text-[16px]"
              placeholder={
                emailMode
                  ? "Paste the whole email. Layover reads it as data, never as instructions."
                  : "Tell me about your trip… e.g. LH761 FRA→BLR Dec 20, Hotel Lumen Goa HX-2231 Dec 22–24"
              }
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            {!text && (
              <div className="mt-3 flex flex-wrap gap-2" aria-label="Examples">
                {EXAMPLES.map((ex) => (
                  <button
                    key={ex}
                    onClick={() => setText(ex)}
                    className="rounded-pill border border-line-warm bg-white px-3 py-1 text-[13px] text-ink-2 hover:border-olive-600"
                  >
                    {ex.length > 48 ? `${ex.slice(0, 48)}…` : ex}
                  </button>
                ))}
              </div>
            )}
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button className="btn btn-secondary" onClick={() => setEmailMode((m) => !m)}>
                {emailMode ? "Type it instead" : "Paste confirmation email"}
              </button>
              <button
                className="btn btn-primary"
                disabled={state === "loading" || text.trim().length < 3}
                onClick={() => submit()}
              >
                Add trip →
              </button>
              {health?.demoMode && (
                <button className="btn btn-secondary" onClick={demoTrip}>
                  Load demo trip
                </button>
              )}
            </div>

            {state === "loading" && (
              <div className="mt-6" aria-live="polite">
                <p className="t-small text-muted">Reading your trip…</p>
                <Skeleton className="mt-2 h-28 w-full" />
              </div>
            )}
            {state === "error" && (
              <p role="alert" className="mt-4 text-danger">
                Couldn&apos;t read that. Try &apos;flight number, route, date&apos;.
              </p>
            )}
            {missing.length > 0 && (
              <div className="card mt-6 p-4" aria-live="polite">
                <p className="t-caption text-muted">One more thing</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {missing.map((m) => (
                    <StatusChip key={m} kind="action">
                      {m}
                    </StatusChip>
                  ))}
                </div>
                <div className="mt-3 flex gap-2">
                  <input
                    aria-label="Your answer"
                    className="input"
                    value={answer}
                    onChange={(e) => setAnswer(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && answerMissing()}
                    placeholder="e.g. I'm Priya"
                  />
                  <button className="btn btn-primary" onClick={answerMissing} disabled={!answer.trim()}>
                    Continue
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>

        <section aria-label="Recent trips" className="mt-6">
          <h2 className="t-h2">Recent trips</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {trips === null && <Skeleton className="h-36" />}
            {trips?.length === 0 && <p className="text-muted">No trips yet. Add one above.</p>}
            {trips?.map(({ trip, session }) => (
              <TripCard key={trip.id} trip={trip} session={session} href={`/trips/${trip.id}`} />
            ))}
          </div>
        </section>
      </main>
    </>
  );
}
