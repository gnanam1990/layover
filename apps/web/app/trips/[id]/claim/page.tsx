"use client";
import { use, useEffect, useState } from "react";
import Link from "next/link";
import { formatMoney, type ClaimPack } from "@layover/shared";
import { api } from "../../../../lib/api";
import { shortHash } from "../../../../lib/format";
import { TopBar } from "../../../../components/TopBar";
import { Caption, Card, ExtLink, Skeleton, StatusChip } from "../../../../components/ui";

const KIND: Record<string, string> = {
  refund: "Refund",
  reroute: "Re-routing",
  compensation: "Compensation",
  care_meal: "Meals",
  care_hotel: "Hotel",
  care_transport: "Transport",
};

export default function ClaimPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [claim, setClaim] = useState<{ pack: ClaimPack; mailto: string | null } | null | undefined>(
    undefined,
  );
  const [copied, setCopied] = useState<boolean | null>(false);
  useEffect(() => {
    api
      .claim(id)
      .then(setClaim)
      .catch(() => setClaim(null));
  }, [id]);

  if (claim === undefined)
    return (
      <>
        <TopBar />
        <main className="mx-auto max-w-[900px] px-4 py-6">
          <Skeleton className="h-96" />
        </main>
      </>
    );
  if (claim === null)
    return (
      <>
        <TopBar />
        <main className="mx-auto max-w-[900px] px-4 py-10">
          <p className="text-muted">
            No claim yet. Layover drafts one when your flight is disrupted.{" "}
            <Link href={`/trips/${id}`} className="text-olive-700 underline">
              Back to the trip
            </Link>
          </p>
        </main>
      </>
    );

  const { pack, mailto } = claim;
  const letter = `Subject: ${pack.letter.subject}\n\n${pack.letter.body}`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(letter);
      setCopied(true);
      return;
    } catch {
      // Clipboard API blocked (permissions/insecure context): fall back to a hidden textarea.
    }
    const ta = document.createElement("textarea");
    ta.value = letter;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    setCopied(ok ? true : null);
  };
  return (
    <>
      <TopBar />
      <main className="mx-auto grid max-w-[900px] gap-6 px-4 pb-24 pt-6">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="t-h1">Your claim to {pack.airline}</h1>
          {pack.validated ? (
            <StatusChip kind="protected" dot>
              Checked: nothing invented
            </StatusChip>
          ) : (
            <StatusChip kind="watching">Standard letter</StatusChip>
          )}
        </div>
        <Card aria-label="Entitlements">
          <Caption>What you&apos;re asking for</Caption>
          <ul className="mt-2 divide-y divide-line">
            {pack.entitlements.map((e, i) => (
              <li key={i} className="flex flex-wrap items-center gap-3 py-2">
                <span className="font-medium text-ink">{KIND[e.kind] ?? e.kind}</span>
                {e.amount && <span className="mono">{formatMoney(e.amount)}</span>}
                {e.amountUpTo && <span className="mono">up to {formatMoney(e.amountUpTo)}</span>}
                <span className="t-small text-muted">{e.basis}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card aria-label="Receipts">
          <Caption>Receipts</Caption>
          {pack.receipts.length === 0 ? (
            <p className="t-small mt-2 text-muted">No paid receipts for this disruption.</p>
          ) : (
            <table className="mt-2 w-full text-left">
              <thead>
                <tr className="t-small text-muted">
                  <th className="py-1 font-medium">Description</th>
                  <th className="py-1 font-medium">Amount</th>
                  <th className="py-1 font-medium">Transaction</th>
                </tr>
              </thead>
              <tbody>
                {pack.receipts.map((r) => (
                  <tr key={r.tx} className="border-t border-line">
                    <td className="py-2 pr-3">{r.desc}</td>
                    <td className="mono py-2 pr-3">{formatMoney(r.amount)}</td>
                    <td className="py-2">
                      <ExtLink href={r.explorerUrl}>{shortHash(r.tx)}</ExtLink>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <Card aria-label="Letter">
          <Caption>Letter</Caption>
          <p className="mt-2 font-medium text-ink">{pack.letter.subject}</p>
          <pre className="mt-3 whitespace-pre-wrap font-sans text-[15px] leading-6 text-ink-2">
            {pack.letter.body}
          </pre>
          <div className="mt-4 flex flex-wrap gap-3">
            <button className="btn btn-secondary" onClick={copy}>
              {copied ? "Copied" : copied === null ? "Copy blocked: select the letter text" : "Copy letter"}
            </button>
            {mailto ? (
              <a className="btn btn-primary" href={mailto}>
                Open email
              </a>
            ) : (
              <span className="t-small self-center text-muted">
                Too long for an email link: copy the letter instead.
              </span>
            )}
          </div>
        </Card>
        <p className="t-small text-muted">
          Not legal advice · Based on {pack.packs?.join(", ").toUpperCase().replace("_", " ")} rule packs ·{" "}
          <a
            className="text-olive-700 underline"
            href="https://eur-lex.europa.eu/eli/reg/2004/261/oj"
            target="_blank"
            rel="noreferrer noopener"
          >
            official source
          </a>
          . Amounts marked &lsquo;up to&rsquo; need confirming with the airline.
        </p>
      </main>
    </>
  );
}
