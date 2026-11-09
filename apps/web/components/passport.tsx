"use client";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import type { SessionRecord } from "@layover/shared";
import { dateTime, money } from "../lib/format";

/** Kite Passport handoff, in the Passport sub-brand (Spectral headline, orange accent). */
export function PassportHandoff({
  session,
  priceScale,
  onSimulateApprove,
}: {
  session: SessionRecord;
  priceScale: number;
  onSimulateApprove?: () => void;
}) {
  const [qr, setQr] = useState<string>("");
  const url = session.approvalUrl ?? "";
  useEffect(() => {
    if (url.startsWith("http"))
      QRCode.toDataURL(url, { margin: 1, width: 168, color: { dark: "#121110", light: "#ffffff" } }).then(
        setQr,
      );
  }, [url]);
  const settle = (m: { amountMinor: string }) => (Number(m.amountMinor) / 100 / priceScale).toFixed(2);
  return (
    <section
      aria-label="Approve with Kite Passport"
      className="anim-in rounded-panel border border-pp-cream bg-white p-6 shadow-card"
    >
      <p className="t-caption text-pp-muted">Kite Agent Passport</p>
      <h2
        className="mt-2 text-[28px] leading-[34px] text-pp-ink"
        style={{ fontFamily: "var(--font-serif-pp)" }}
      >
        Approve Layover&apos;s trip budget
      </h2>
      <div className="mt-4 grid gap-6 sm:grid-cols-[1fr_auto]">
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-pp-ink">
          <dt className="text-pp-muted">Per booking</dt>
          <dd className="mono">{money(session.maxPerTx)}</dd>
          <dt className="text-pp-muted">Total</dt>
          <dd className="mono">{money(session.maxTotal)}</dd>
          <dt className="text-pp-muted">Valid until</dt>
          <dd className="mono">{dateTime(session.ttlUntilUtc)}</dd>
          <dt className="text-pp-muted">Settles in</dt>
          <dd>
            USD stablecoin on Kite · demo scale 1:{priceScale} ({settle(session.maxTotal)} total)
          </dd>
        </dl>
        {qr && (
          <img
            src={qr}
            alt="QR code to open the Kite Passport approval page"
            width={168}
            height={168}
            className="rounded"
          />
        )}
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        {url.startsWith("http") && (
          <a className="btn btn-passport" href={url} target="_blank" rel="noreferrer noopener">
            Open Kite Passport
          </a>
        )}
        {onSimulateApprove && (
          <button className="btn btn-secondary" onClick={onSimulateApprove}>
            Simulate passkey (fake payer)
          </button>
        )}
        <span className="t-small text-pp-muted" aria-live="polite">
          Waiting for your passkey<span className="wait-dot">.</span>
          <span className="wait-dot [animation-delay:200ms]">.</span>
          <span className="wait-dot [animation-delay:400ms]">.</span>
        </span>
      </div>
    </section>
  );
}
