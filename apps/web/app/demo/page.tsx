"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { formatMoney, type Money } from "@layover/shared";
import { ACT1, ACT2, api } from "../../lib/api";
import { TopBar, useHealth } from "../../components/TopBar";
import { Caption, Card, StatusChip } from "../../components/ui";

type DemoState = {
  hotels: { hotelId: string; hotelName: string; roomClass: string; price: Money }[];
  flights: Record<string, { state: string; depDelayMin: number } | null>;
};

export default function DemoPage() {
  const health = useHealth();
  const [state, setState] = useState<DemoState | null>(null);
  const [msg, setMsg] = useState<string>("");
  const load = useCallback(
    () =>
      void api.demo
        .state()
        .then(setState)
        .catch(() => setState(null)),
    [],
  );
  useEffect(load, [load]);
  const act = (label: string, fn: () => Promise<unknown>) => async () => {
    setMsg(`${label}…`);
    try {
      await fn();
      setMsg(`${label}: done`);
    } catch (e) {
      setMsg(`${label}: ${(e as Error).message}`);
    }
    load();
  };
  const big = "btn btn-primary px-6 py-4 text-[16px]";
  if (health && !health.demoMode) return <p className="p-8">Demo controls are off (DEMO_MODE=0).</p>;
  return (
    <>
      <TopBar />
      <main className="mx-auto grid max-w-[900px] gap-6 px-4 pb-24 pt-6">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="t-h1">Demo controls</h1>
          <StatusChip kind="simulated">Everything here is simulated</StatusChip>
        </div>
        <Card>
          <Caption>Setup</Caption>
          <div className="mt-3 flex flex-wrap gap-3">
            <button className="btn btn-secondary" onClick={act("Load demo trip", () => api.demo.seed())}>
              Load demo trip
            </button>
            <button
              className="btn btn-secondary"
              onClick={act("Demo clock", () => api.demo.time("2026-12-20T19:30:00Z"))}
            >
              Set clock to Dec 20, 19:30 UTC
            </button>
            <Link className="btn btn-secondary" href="/trips/trip_demo">
              Open demo trip →
            </Link>
          </div>
        </Card>
        <Card>
          <Caption>Recording</Caption>
          <div className="mt-3 flex flex-wrap gap-4">
            <button
              className={big}
              onClick={act("Act 1: drop hotel price", () => api.demo.price(ACT1.hotelId, ACT1.newPrice))}
            >
              Act 1 · Drop Hotel Lumen to $58
            </button>
            <button className={big} onClick={act("Act 2: cancel LH761", () => api.demo.flight(ACT2))}>
              Act 2 · Cancel LH761
            </button>
            <button className="btn btn-secondary px-6 py-4" onClick={act("Reset", () => api.demo.reset())}>
              Reset
            </button>
          </div>
          <p className="t-small mt-3 text-muted" aria-live="polite">
            {msg}
          </p>
        </Card>
        <Card>
          <Caption>Mock world</Caption>
          <table className="mt-2 w-full text-left">
            <tbody>
              {state?.hotels.map((h) => (
                <tr key={`${h.hotelId}-${h.roomClass}`} className="border-t border-line">
                  <td className="py-1.5">{h.hotelName}</td>
                  <td className="t-small py-1.5 text-muted">{h.roomClass}</td>
                  <td className="mono py-1.5">{formatMoney(h.price)}</td>
                </tr>
              ))}
              {state &&
                Object.entries(state.flights).map(([id, f]) => (
                  <tr key={id} className="border-t border-line">
                    <td className="mono py-1.5">{id}</td>
                    <td className="t-small py-1.5 text-muted">flight</td>
                    <td className="py-1.5">
                      {f ? `${f.state}${f.depDelayMin ? ` +${f.depDelayMin} min` : ""}` : "unknown"}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </Card>
      </main>
    </>
  );
}
