"use client";
import { useEffect, useState } from "react";
import { api, type DataPurchases } from "../lib/api";
import { Caption, Card } from "./ui";

/** Every real-data lookup is a Kite Passport payment on Base; each one is checked on-chain (Alchemy or public RPC). */
export function DataReceipts({ refreshKey }: { refreshKey: number }) {
  const [d, setD] = useState<DataPurchases | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .dataPurchases()
        .then((x) => alive && setD(x))
        .catch(() => alive && setD(null));
    load();
    // Keep polling while some receipts are still being checked.
    const t = setInterval(load, 5_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [refreshKey]);
  if (!d?.enabled || d.count === 0) return null;
  const pending = d.count - d.verified - d.failed;
  return (
    <Card aria-label="Real data bought via Kite">
      <Caption>Real data bought via Kite</Caption>
      <p className="t-small mt-2 text-ink">
        <span className="mono">{d.count}</span> lookups · <span className="mono">${d.totalUsd}</span> ·{" "}
        <span className="text-olive-700">{d.verified} verified on Base</span>
        {pending > 0 && <span className="text-muted"> · {pending} checking</span>}
        {d.failed > 0 && <span className="text-danger"> · {d.failed} mismatched</span>}
      </p>
      <ul className="mt-2 space-y-1">
        {d.purchases.slice(0, 5).map((p) => (
          <li key={`${p.url}${p.atUtc}`} className="t-small flex flex-wrap items-center gap-2">
            <span
              aria-label={p.verified === true ? "verified" : p.verified === false ? "mismatch" : "checking"}
            >
              {p.verified === true ? "✓" : p.verified === false ? "✕" : "…"}
            </span>
            <span className="text-ink">{p.label}</span>
            {p.amount && <span className="mono text-muted">${p.amount}</span>}
            {p.explorerUrl && (
              <a
                className="text-olive-700 underline"
                href={p.explorerUrl}
                target="_blank"
                rel="noreferrer noopener"
              >
                BaseScan ↗
              </a>
            )}
          </li>
        ))}
      </ul>
      <p className="t-small mt-2 text-muted">
        Checked on-chain via {d.verifier === "alchemy" ? "Alchemy" : "Base public RPC"}: exact USDC amount
        from your Passport wallet.
      </p>
    </Card>
  );
}
