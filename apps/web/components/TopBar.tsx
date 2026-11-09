"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api, type Health } from "../lib/api";
import { Logo, StatusChip } from "./ui";

export function useHealth() {
  const [h, setH] = useState<Health | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .health()
        .then((x) => alive && setH(x))
        .catch(() => alive && setH(null));
    load();
    const t = setInterval(load, 15_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  return h;
}

export function TopBar({ protectedTrip = false }: { protectedTrip?: boolean }) {
  const h = useHealth();
  return (
    <header className="sticky top-0 z-20 px-4 pt-4">
      <nav
        aria-label="Main"
        className="mx-auto flex max-w-[1200px] flex-wrap items-center gap-3 rounded-panel border sm:rounded-pill border-line-warm bg-white px-4 py-2 shadow-card"
      >
        <Link href="/" className="mr-2">
          <Logo />
        </Link>
        <Link href="/" className="t-small text-ink-2 hover:text-ink">
          Trips
        </Link>
        {protectedTrip && (
          <StatusChip kind="protected" dot>
            Protected
          </StatusChip>
        )}
        <span className="ml-auto flex flex-wrap items-center gap-2">
          {h && (
            <StatusChip kind="neutral">
              {h.network === "testnet" ? "Kite testnet" : "Kite mainnet"} · demo scale 1:{h.priceScale}
            </StatusChip>
          )}
          {h?.serv === "offline-stub" && <StatusChip kind="action">SERV offline stub</StatusChip>}
          {h?.payer === "fake" && <StatusChip kind="action">Fake payer</StatusChip>}
          {h?.payer === "direct" && <StatusChip kind="watching">Direct x402 (testnet)</StatusChip>}
          {h?.realData && (
            <StatusChip kind="protected" dot>
              Live data via Kite
            </StatusChip>
          )}
          {h?.demoClock && <StatusChip kind="simulated">Demo clock</StatusChip>}
          {h?.demoMode && (
            <Link
              href="/demo"
              className="t-small font-medium text-olive-700 underline-offset-4 hover:underline"
            >
              Demo controls
            </Link>
          )}
          {h === null && <StatusChip kind="error">Core offline</StatusChip>}
        </span>
      </nav>
    </header>
  );
}
