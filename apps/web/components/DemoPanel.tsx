"use client";
import { useState } from "react";
import { ACT1, ACT2, api } from "../lib/api";

/** Floating demo controls (DEMO_MODE only). Every effect is labeled Simulated on the timeline. */
export function DemoPanel() {
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState(true);
  const run = (label: string, fn: () => Promise<unknown>) => async () => {
    setBusy(label);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  };
  const btn =
    "rounded-pill border border-line-warm bg-white px-3 py-1.5 text-[13px] font-medium text-ink hover:border-olive-600 disabled:opacity-50";
  return (
    <aside
      aria-label="Demo controls (simulated)"
      className="fixed bottom-4 left-4 z-30 max-w-[calc(100vw-2rem)] rounded-card border border-dashed border-muted-2 bg-paper/95 p-3 shadow-card backdrop-blur"
    >
      <div className="flex items-center justify-between gap-3">
        <p className="t-caption text-muted">Demo controls (simulated)</p>
        <button
          className="t-small text-muted underline-offset-4 hover:underline"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? "Hide" : "Show"}
        </button>
      </div>
      <div className={`mt-2 flex-wrap gap-2 ${open ? "flex" : "hidden"}`}>
        <button
          className={btn}
          disabled={!!busy}
          onClick={run("drop", () => api.demo.price(ACT1.hotelId, ACT1.newPrice))}
        >
          Drop hotel price
        </button>
        <button className={btn} disabled={!!busy} onClick={run("cancel", () => api.demo.flight(ACT2))}>
          Cancel flight
        </button>
        <button
          className={btn}
          disabled={!!busy}
          onClick={run("delay", () =>
            api.demo.flight({
              id: ACT2.id,
              state: "delayed",
              depDelayMin: 240,
              arrDelayMin: 240,
              reasonClass: "technical",
              noticeText: "LH761 is delayed by 4 hours due to a technical issue.",
            }),
          )}
        >
          Delay flight 4h
        </button>
        <a className={btn} href="/demo">
          More…
        </a>
      </div>
      {busy && (
        <p className="t-small mt-2 text-muted" aria-live="polite">
          Working…
        </p>
      )}
    </aside>
  );
}
