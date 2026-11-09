import {
  ClaimPack,
  formatMoney,
  type ClaimLetter,
  type Entitlement,
  type Money,
  type Receipt,
} from "@layover/shared";
import type { Clock } from "../clock";
import type { Db } from "../db";
import type { TimelineStore } from "../timeline/store";
import type { TripRepo } from "../trips/repo";
import { ServValidationError, type ServClient } from "../serv/client";
import { claimDraft } from "../serv/prompts/claimDraft";
import type { DisruptionInfo } from "../disruption/detector";
import { PACK_LABEL } from "../disruption/detector";

/** Everything the letter may mention. Built by code from trusted sources only. */
export interface ClaimData {
  traveler: string;
  airline: string;
  flight: { id: string; number: string; from: string; to: string; date: string; bookingRef: string | null };
  entitlements: {
    pack: string;
    kind: Entitlement["kind"];
    amount?: Money;
    amountUpTo?: Money;
    confidence: Entitlement["confidence"];
    basis: string;
  }[];
  timeline: { atUtc: string; title: string }[];
  receipts: Receipt[];
}

const KIND: Record<string, string> = {
  refund: "Refund of the ticket",
  reroute: "Re-routing to my destination",
  compensation: "Compensation",
  care_meal: "Meals and refreshments while waiting",
  care_hotel: "Hotel accommodation",
  care_transport: "Transport between airport and hotel",
};

const amountText = (e: ClaimData["entitlements"][number]) =>
  e.amount ? formatMoney(e.amount) : e.amountUpTo ? `up to ${formatMoney(e.amountUpTo)}` : "";

/** Deterministic letter: used when SERV's draft can't be validated, and as the reference for tests. */
export function templateLetter(d: ClaimData): ClaimLetter {
  const lines = [
    `Dear ${d.airline} customer relations,`,
    "",
    `I am writing about flight ${d.flight.number} from ${d.flight.from} to ${d.flight.to} on ${d.flight.date}${d.flight.bookingRef ? `, booking reference ${d.flight.bookingRef}` : ""}.`,
    "",
    "What happened:",
    ...d.timeline.map((t) => `- ${t.atUtc.slice(0, 16).replace("T", " ")} UTC: ${t.title}`),
    "",
    "I request the following:",
    ...d.entitlements.map(
      (e) => `- ${KIND[e.kind] ?? e.kind}${amountText(e) ? `: ${amountText(e)}` : ""} (${e.basis})`,
    ),
  ];
  if (d.receipts.length) {
    lines.push("", "Care costs I paid myself, for reimbursement (receipts attached):");
    for (const r of d.receipts)
      lines.push(`- ${r.desc}: ${formatMoney(r.amount)}, transaction ${r.tx} (${r.explorerUrl})`);
  }
  lines.push(
    "",
    "Please pay to my original form of payment or by bank transfer, and reply within 14 days.",
    "",
    "Kind regards,",
    d.traveler,
  );
  return {
    subject: `Claim for ${d.flight.number} ${d.flight.from}-${d.flight.to} on ${d.flight.date}${d.flight.bookingRef ? ` (${d.flight.bookingRef})` : ""}`,
    body: lines.join("\n"),
  };
}

function allowedNumbers(d: ClaimData): Set<string> {
  const json = JSON.stringify(d);
  const s = new Set<string>(["14"]); // the 14-day response deadline is part of the instructions
  for (const m of json.matchAll(/\d+/g)) s.add(String(Number(m[0])));
  for (const m of json.matchAll(/"amountMinor":"(\d+)"/g)) s.add((BigInt(m[1]!) / 100n).toString());
  return s;
}

/** Post-check (M09): every amount, tx and booking ref in the letter must exist in ClaimData; VERIFY amounts say "up to". */
export function checkLetter(l: ClaimLetter, d: ClaimData) {
  const text = `${l.subject}\n${l.body}`;
  const txs = new Set(d.receipts.map((r) => r.tx.toLowerCase()));
  for (const m of text.matchAll(/0x[0-9a-fA-F]+/g)) {
    if (!txs.has(m[0].toLowerCase()))
      throw new ServValidationError(`letter cites a transaction not in ClaimData: ${m[0]}`);
  }
  const withoutTx = text.replace(/0x[0-9a-fA-F]+/g, "").replace(/https?:\/\/\S+/g, "");
  const REF = /\b(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{5,8}\b/g;
  const refs = new Set([...JSON.stringify(d).toUpperCase().matchAll(REF)].map((m) => m[0]));
  for (const m of withoutTx.matchAll(REF)) {
    if (!refs.has(m[0]) && !/^\d+$/.test(m[0]))
      throw new ServValidationError(`letter cites a booking reference not in ClaimData: ${m[0]}`);
  }
  const allowed = allowedNumbers(d);
  const normalized = withoutTx.replace(/(\d),(?=\d{3}\b)/g, "$1");
  for (const m of normalized.matchAll(/\d+(?:\.\d+)?/g)) {
    const n = String(Number(m[0].split(".")[0]));
    if (!allowed.has(n)) throw new ServValidationError(`letter contains a number not in ClaimData: ${m[0]}`);
  }
  for (const e of d.entitlements) {
    if (!e.amountUpTo) continue;
    const f = formatMoney(e.amountUpTo);
    let i = text.indexOf(f);
    while (i >= 0) {
      if (!/up to\s*$/i.test(text.slice(Math.max(0, i - 8), i))) {
        throw new ServValidationError(`VERIFY amount ${f} must be phrased "up to"`);
      }
      i = text.indexOf(f, i + f.length);
    }
  }
}

/** `mailto:` link, or null when it would exceed 2,000 characters (then the UI offers copy only). */
export function mailtoLink(l: ClaimLetter): string | null {
  const enc = (s: string) => encodeURIComponent(s);
  const link = `mailto:?subject=${enc(l.subject)}&body=${enc(l.body)}`;
  return link.length <= 2000 ? link : null;
}

export interface ClaimDeps {
  db: Db;
  clock: Clock;
  timeline: TimelineStore;
  trips: TripRepo;
  serv: ServClient;
}

const CLAIM_TIMELINE_TYPES = new Set(["disruption", "voucher_warning", "rescue_booked", "flight_status"]);

export class ClaimBuilder {
  constructor(private d: ClaimDeps) {}

  latest(tripId: string): ClaimPack | undefined {
    const row = this.d.db
      .query<{ json: string }, [string]>(
        "SELECT json FROM claims WHERE tripId = ? ORDER BY atUtc DESC, rowid DESC LIMIT 1",
      )
      .get(tripId);
    return row ? ClaimPack.parse(JSON.parse(row.json)) : undefined;
  }

  data(info: DisruptionInfo): ClaimData {
    const trip = this.d.trips.get(info.tripId)!;
    const events = this.d.timeline.list(info.tripId);
    const receipts = events
      .filter((e) => e.type === "rescue_booked")
      .map((e) => (e.data as { receipt?: Receipt } | undefined)?.receipt)
      .filter((r): r is Receipt => !!r && !!r.tx);
    return {
      traveler: trip.travelerName,
      airline: info.flight.carrier,
      flight: {
        id: info.flight.id,
        number: `${info.flight.carrier}${info.flight.number}`,
        from: info.flight.from,
        to: info.flight.to,
        date: info.nightDate,
        bookingRef: info.flight.bookingRef ?? null,
      },
      entitlements: info.assessment.packs.flatMap((p) =>
        p.entitlements.map((e) => ({
          pack: PACK_LABEL[p.pack],
          kind: e.kind,
          ...(e.amount && { amount: e.amount }),
          ...(e.amountUpTo && { amountUpTo: e.amountUpTo }),
          confidence: e.confidence,
          basis: e.basis,
        })),
      ),
      timeline: events
        .filter((e) => CLAIM_TIMELINE_TYPES.has(e.type))
        .map((e) => ({ atUtc: e.atUtc, title: e.title })),
      receipts,
    };
  }

  async build(info: DisruptionInfo): Promise<ClaimPack> {
    const data = this.data(info);
    let letter: ClaimLetter;
    let validated = true;
    try {
      letter = await claimDraft(this.d.serv, data, (l) => checkLetter(l, data));
    } catch {
      letter = templateLetter(data);
      validated = false;
    }
    const pack: ClaimPack = {
      id: `claim_${crypto.randomUUID().slice(0, 8)}`,
      tripId: info.tripId,
      flightId: info.flight.id,
      airline: info.flight.carrier,
      packs: info.assessment.packs.map((p) => p.pack),
      entitlements: info.assessment.packs.flatMap((p) => p.entitlements),
      timeline: data.timeline,
      receipts: data.receipts,
      letter,
      validated,
    };
    ClaimPack.parse(pack);
    this.d.db
      .query("INSERT INTO claims (id, tripId, json, atUtc) VALUES (?, ?, ?, ?)")
      .run(pack.id, info.tripId, JSON.stringify(pack), this.d.clock.now().toISOString());
    this.d.timeline.append({
      tripId: info.tripId,
      type: "claim_ready",
      title: `Your claim to ${info.flight.carrier} is ready`,
      detail: validated
        ? `Drafted by SERV and checked: every amount and receipt comes from your records. ${data.receipts.length} receipt(s) attached.`
        : "Using Layover's standard letter (the AI draft didn't pass the checks). Every amount comes from your records.",
      data: { claimId: pack.id, validated },
      links: [{ label: "Open claim", url: `/trips/${info.tripId}/claim` }],
    });
    return pack;
  }
}
