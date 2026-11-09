import {
  AIRPORTS,
  RULE_PACKS,
  RULES_DISCLAIMER,
  formatMoney,
  type Confidence,
  type Entitlement,
  type Flight,
  type FlightStatus,
  type Money,
  type NoticeFacts,
  type PackAssessment,
  type PackId,
  type RightsAssessment,
  type RulePack,
} from "@layover/shared";
import { flightDistanceKm } from "./distance";

/**
 * Deterministic passenger-rights engine (TDD §10). PURE: rule packs + parsed facts in, assessment out.
 * It never reads free text (no notice text input), and every amount comes from pack data.
 */
export interface AssessInput {
  flight: Flight;
  status: FlightStatus;
  facts: NoticeFacts | null;
  now: Date;
  /** US DOT: the traveler declined the airline's alternative (refund becomes due). */
  declinedAlternative?: boolean;
  packs?: Record<PackId, RulePack>;
}

const DISRUPTION_MIN = 120;
const DAY_MS = 86_400_000;
const OVERNIGHT_LATEST_HOUR = 23;
const NEXT_MORNING_HOUR = 6;

// ---------- time helpers ----------
function localParts(iso: string, tz: string) {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const p = Object.fromEntries(f.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), minute: Number(p.minute) };
}
export const localDate = (iso: string, tz: string) => localParts(iso, tz).date;
const localStamp = (iso: string, tz: string) => {
  const p = localParts(iso, tz);
  return `${p.date}T${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
};
const nextDay = (date: string) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

/** "LH763 2026-12-21 08:40Z" → ISO instant (UTC assumed when no offset is given). */
export function parseAlternativeTime(s: string): string | null {
  const m = /(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})(?::\d{2})?\s*(Z|[+-]\d{2}:?\d{2})?/.exec(s);
  if (!m) return null;
  const off =
    !m[4] || m[4] === "Z" ? "Z" : m[4].includes(":") ? m[4] : `${m[4].slice(0, 3)}:${m[4].slice(3)}`;
  const t = Date.parse(`${m[1]}T${m[2]}:${m[3]}:00${off}`);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/**
 * Overnight needed if (cancelled AND no offered alternative departs before 06:00 local next day)
 * OR (departure pushed past 23:00 local / to the next day). nightDate = local date of the original departure.
 */
export function overnightNeeded(flight: Flight, status: FlightStatus, facts: NoticeFacts | null) {
  const tz = AIRPORTS[flight.from]?.tz ?? "UTC";
  const nightDate = localDate(flight.schedDepUtc, tz);
  const cancelled = status.state === "cancelled" || facts?.state === "cancelled";
  if (cancelled) {
    const limit = `${nextDay(nightDate)}T${String(NEXT_MORNING_HOUR).padStart(2, "0")}:00`;
    const early = (facts?.offeredAlternatives ?? [])
      .map(parseAlternativeTime)
      .some((iso) => iso !== null && localStamp(iso, tz) < limit);
    return { needed: !early, nightDate };
  }
  const delay = Math.max(status.depDelayMin, 0);
  if (delay > 0 || facts?.newDepUtc) {
    const newDep =
      facts?.newDepUtc ?? new Date(Date.parse(flight.schedDepUtc) + delay * 60_000).toISOString();
    const p = localParts(newDep, tz);
    return { needed: p.date > nightDate || p.hour >= OVERNIGHT_LATEST_HOUR, nightDate };
  }
  return { needed: false, nightDate };
}

// ---------- rule helpers ----------
const conf = (p: RulePack, key: string): Confidence =>
  p.entries.find((e) => e.key === key)?.confidence ?? "MEDIUM";
const minor = (amount: number, currency: string): Money => ({
  amountMinor: String(amount * 100),
  currency: currency as Money["currency"],
});
const region = (iata: string) => AIRPORTS[iata]?.region ?? "OTHER";
const str = (v: unknown) => (typeof v === "string" ? v : "");
const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);
const num = (v: unknown, d: number) => (typeof v === "number" ? v : d);
const rec = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" ? (v as Record<string, unknown>) : {};

interface Ctx {
  flight: Flight;
  cancelled: boolean;
  depDelay: number;
  arrDelay: number;
  reason: string;
  noticeDays: number;
  overnight: boolean;
  declined: boolean;
  facts: NoticeFacts | null;
  /** Local hour (0–23) of the scheduled departure at the origin airport. */
  depLocalHour: number;
}

function entitlement(
  p: RulePack,
  kind: Entitlement["kind"],
  key: string,
  basis: string,
  amount?: Money,
  forceConfidence?: Confidence,
): Entitlement {
  const c = forceConfidence ?? conf(p, key);
  return {
    kind,
    ...(amount && c !== "VERIFY" && { amount }),
    ...(amount && c === "VERIFY" && { amountUpTo: amount }),
    confidence: c,
    basis,
    sourceUrl: p.officialUrl,
  };
}

/** Art. 5(1)(c)(ii)-(iii): short-notice cancellations are exempt when the offered re-route is close enough in time. */
function rerouteExempt(p: RulePack, x: Ctx): boolean {
  const windows = (
    Array.isArray(rec(p.cancellation).rerouteExemptions) ? rec(p.cancellation).rerouteExemptions : []
  ) as {
    minNoticeDays: number;
    maxEarlyMin: number;
    maxLateMin: number;
  }[];
  const w = [...windows]
    .sort((a, b) => b.minNoticeDays - a.minNoticeDays)
    .find((v) => x.noticeDays >= v.minNoticeDays);
  if (!w) return false;
  const dep = Date.parse(x.flight.schedDepUtc);
  return (x.facts?.offeredAlternatives ?? []).some((alt) => {
    const t = parseAlternativeTime(alt);
    if (!t) return false;
    const shiftMin = (Date.parse(t) - dep) / 60_000; // same block time assumed, so arrival shifts equally
    return -shiftMin <= w.maxEarlyMin && shiftMin < w.maxLateMin;
  });
}

function euLike(p: RulePack, x: Ctx): PackAssessment | null {
  const ap = rec(p.applies);
  const dep = arr(ap.departRegions);
  const arrive = arr(ap.arriveRegions);
  const carriers = arr(ap.arriveRequiresCarrierCountries);
  const from = region(x.flight.from);
  const to = region(x.flight.to);
  const label = p.id === "eu261" ? "EU261" : "UK261";
  let why = "";
  if (dep.includes(from))
    why = `Departs from ${x.flight.from} (${from}), so ${label} applies with any airline.`;
  else if (arrive.includes(to) && carriers.includes(x.flight.airlineCountry ?? "")) {
    why = `Arrives in ${x.flight.to} (${to}) on a carrier licensed there.`;
  } else return null;

  const d = flightDistanceKm(x.flight.from, x.flight.to);
  const bands = p.bands ?? [];
  const intra = dep.includes(from) && dep.includes(to);
  const band =
    intra && d > 1500 && typeof p.intraEuOver1500UsesBand === "number"
      ? bands[p.intraEuOver1500UsesBand as number]!
      : bands.find((b) => b.maxKm === null || d <= b.maxKm)!;
  const bandIdx = bands.indexOf(band);
  const bandName = "ABC"[bandIdx] ?? "?";
  const comp = minor(band.amount, band.currency);
  const extraordinary = arr(p.extraordinaryReasons).includes(x.reason);
  const ents: Entitlement[] = [];
  const doNot: string[] = [];
  const actions: string[] = [];
  const vw = rec(p.voucherWarning);
  const care = rec(p.care);

  if (x.cancelled) {
    ents.push(entitlement(p, "refund", "refundOrReroute", `${label} Art. 8: full refund of the ticket`));
    ents.push(
      entitlement(p, "reroute", "refundOrReroute", `${label} Art. 8: re-routing at the earliest opportunity`),
    );
    const notice = num(rec(p.cancellation).noCompensationIfNoticeDays, 14);
    const exempt = rerouteExempt(p, x);
    if (x.noticeDays < notice && !extraordinary && !exempt) {
      ents.push(
        entitlement(
          p,
          "compensation",
          "compensation.bands",
          `${label} Art. 7: band ${bandName}, ${Math.round(d)} km`,
          comp,
        ),
      );
    }
    if (x.noticeDays < notice) {
      ents.push(
        entitlement(p, "care_meal", "care.meals", `${label} Art. 9: meals and refreshments while you wait`),
      );
      if (x.overnight && care.hotelIfOvernight) {
        ents.push(
          entitlement(
            p,
            "care_hotel",
            "care.hotel",
            `${label} Art. 9: hotel when an overnight stay becomes necessary`,
          ),
        );
        ents.push(
          entitlement(
            p,
            "care_transport",
            "care.hotel",
            `${label} Art. 9: transport between the airport and the hotel`,
          ),
        );
      }
    }
    doNot.push(str(vw.doNot));
  } else {
    const dl = rec(p.delay);
    if (x.arrDelay >= num(dl.compensationArrivalDelayMin, 180) && !extraordinary) {
      const red = rec(dl.longHaulReduction);
      const reduced =
        bandIdx === num(red.appliesToBandIndex, 2) &&
        !intra &&
        x.arrDelay < num(red.arrivalDelayBelowMin, 240);
      ents.push(
        reduced
          ? entitlement(
              p,
              "compensation",
              "delay.longhaul50pct",
              `${label} Art. 7(2)(c) (Sturgeon para 63): band C reduced by 50 % for a 3–4 h arrival delay`,
              minor((band.amount * num(red.bps, 5000)) / 10000, band.currency),
            )
          : entitlement(
              p,
              "compensation",
              "delay.arrival3h",
              `${label} Art. 7 (Sturgeon): arrival ${Math.floor(x.arrDelay / 60)} h ${x.arrDelay % 60} m late, band ${bandName}`,
              comp,
            ),
      );
    }
    if (x.depDelay >= (band.careAfterMin ?? 120)) {
      ents.push(
        entitlement(
          p,
          "care_meal",
          "care.thresholds",
          `${label} Art. 6: meals and refreshments after a ${Math.round((band.careAfterMin ?? 120) / 60)} h delay`,
        ),
      );
    }
    if (x.overnight) {
      ents.push(
        entitlement(
          p,
          "care_hotel",
          "care.hotel",
          `${label} Art. 9: hotel when an overnight stay becomes necessary`,
        ),
      );
      ents.push(
        entitlement(
          p,
          "care_transport",
          "care.hotel",
          `${label} Art. 9: transport between the airport and the hotel`,
        ),
      );
    }
    if (x.depDelay >= num(dl.refundOrRerouteDepDelayMin, 300)) {
      ents.push(
        entitlement(p, "refund", "refundOrReroute", `${label} Art. 6(1)(iii): refund after a 5 h delay`),
      );
      doNot.push(str(vw.doNot));
    }
  }
  if (ents.some((e) => e.kind === "care_hotel")) actions.push(str(vw.action));
  if (ents.some((e) => e.kind === "compensation"))
    actions.push(`Claim compensation from ${x.flight.carrier} with your claim pack.`);
  if (extraordinary)
    why += ` The stated cause (${x.reason}) counts as extraordinary: no cash compensation, but care still applies.`;
  actions.push("Keep every receipt for meals, hotel and transport.");
  return {
    pack: p.id,
    applies: true,
    why,
    entitlements: ents,
    doNot: doNot.filter(Boolean),
    actions: actions.filter(Boolean),
    evidenceNeeded: arr((p as Record<string, unknown>).evidenceNeeded),
  };
}

function usDot(p: RulePack, x: Ctx): PackAssessment | null {
  const from = region(x.flight.from);
  const to = region(x.flight.to);
  if (from !== "US" && to !== "US") return null;
  const domestic = from === "US" && to === "US";
  const dl = rec(p.delay);
  const vw = rec(p.voucherWarning);
  const ents: Entitlement[] = [];
  const threshold = domestic ? num(dl.significantDomesticMin, 180) : num(dl.significantInternationalMin, 360);
  if (x.cancelled) {
    ents.push(
      entitlement(
        p,
        "refund",
        "refund.cancellation",
        "14 CFR 260.6: automatic cash refund to your original payment if you decline the alternative, whatever the cause",
      ),
    );
  } else if (x.arrDelay >= threshold) {
    ents.push(
      entitlement(
        p,
        "refund",
        "delay.significant",
        `14 CFR 260.2: significant change (arriving ${domestic ? "3" : "6"} h+ late), refund if you decline travel`,
      ),
    );
  }
  const controllable = x.reason === "technical" || x.reason === "crew";
  if (controllable && (x.cancelled || x.depDelay >= 180)) {
    ents.push(
      entitlement(
        p,
        "care_meal",
        "care.airlineCommitment",
        "Airline commitment (DOT dashboard), check the airline",
      ),
    );
    if (x.overnight) {
      ents.push(
        entitlement(
          p,
          "care_hotel",
          "care.airlineCommitment",
          "Airline commitment (DOT dashboard), check the airline",
        ),
      );
    }
  }
  const hasRefund = ents.some((e) => e.kind === "refund");
  return {
    pack: "us_dot",
    applies: true,
    why: `${domestic ? "Domestic US flight" : "Flight to or from the US"}: DOT refund rules apply. There is no federal cash compensation for delays.`,
    entitlements: ents,
    doNot: hasRefund ? [str(vw.doNot)] : [],
    actions: hasRefund ? [str(vw.action)] : [],
    evidenceNeeded: arr((p as Record<string, unknown>).evidenceNeeded),
  };
}

function inDgca(p: RulePack, x: Ctx): PackAssessment | null {
  const ap = rec(p.applies);
  const domestic = region(x.flight.from) === "IN" && region(x.flight.to) === "IN";
  if (!arr(ap.carrierCountries).includes(x.flight.airlineCountry ?? "") && !domestic) return null;
  const c = rec(p.cancellation);
  const dl = rec(p.delay);
  const vw = rec(p.voucherWarning);
  const force = arr(p.forceMajeureReasons).includes(x.reason);
  const ents: Entitlement[] = [];
  if (x.cancelled) {
    ents.push(entitlement(p, "refund", "cancellation.altOrRefund", "DGCA CAR S3 M IV 3.6: full refund"));
    ents.push(
      entitlement(p, "reroute", "cancellation.altOrRefund", "DGCA CAR S3 M IV 3.6: alternate flight"),
    );
    if (x.noticeDays * 24 < num(c.noCompensationIfNoticeHours, 24) && !force) {
      const block = (Date.parse(x.flight.schedArrUtc) - Date.parse(x.flight.schedDepUtc)) / 60_000;
      const bands = (Array.isArray(c.blockTimeBands) ? c.blockTimeBands : []) as {
        maxMin: number | null;
        amount: number;
        currency: string;
      }[];
      const band = bands.find((b) => b.maxMin === null || block <= b.maxMin);
      if (band) {
        ents.push(
          entitlement(
            p,
            "compensation",
            "cancellation.compensationBands",
            `DGCA CAR S3 M IV 3.3.2: under 24 h notice, block time ${Math.floor(block / 60)} h ${Math.round(block % 60)} m. ${str(c.capNote)}`,
            minor(band.amount, band.currency),
          ),
        );
      }
    }
  } else {
    const block = (Date.parse(x.flight.schedArrUtc) - Date.parse(x.flight.schedDepUtc)) / 60_000;
    const meals = (Array.isArray(dl.mealsByBlockTime) ? dl.mealsByBlockTime : []) as {
      maxBlockMin: number | null;
      afterMin: number;
    }[];
    const mealAfter = meals.find((m) => m.maxBlockMin === null || block <= m.maxBlockMin)?.afterMin ?? 120;
    if (x.depDelay >= mealAfter)
      ents.push(
        entitlement(
          p,
          "care_meal",
          "delay.meals",
          `DGCA CAR S3 M IV 3.4: meals after a ${mealAfter / 60} h delay`,
        ),
      );
    const altOk = !dl.altOrRefundDomesticOnly || domestic;
    if (altOk && x.depDelay > num(dl.altOrRefundAfterMin, 360)) {
      ents.push(
        entitlement(
          p,
          "refund",
          "delay.altOrRefund",
          "DGCA CAR S3 M IV 3.4: refund after a 6 h delay (domestic)",
        ),
      );
      ents.push(
        entitlement(
          p,
          "reroute",
          "delay.altOrRefund",
          "DGCA CAR S3 M IV 3.4: alternate flight after a 6 h delay (domestic)",
        ),
      );
    }
    const night = rec(dl.hotelNightDeparture);
    const nightDep = x.depLocalHour >= num(night.fromHour, 20) || x.depLocalHour < num(night.toHour, 3);
    if (x.depDelay > num(dl.hotelAfterMin, 1440) || (nightDep && x.depDelay > num(night.afterMin, 360))) {
      ents.push(
        entitlement(
          p,
          "care_hotel",
          "delay.hotel",
          "DGCA CAR S3 M IV 3.4: hotel for a delay over 24 h, or over 6 h for a 20:00–03:00 departure",
        ),
      );
    }
  }
  return {
    pack: "in_dgca",
    applies: true,
    why: `${domestic ? "Domestic Indian flight" : "Indian carrier"}: DGCA passenger charter applies.${force ? ` The stated cause (${x.reason}) is force majeure: refund or alternate flight only.` : ""}`,
    entitlements: ents,
    doNot: ents.some((e) => e.kind === "refund") ? [str(vw.doNot)] : [],
    actions: [str(vw.action)].filter(Boolean),
    evidenceNeeded: arr((p as Record<string, unknown>).evidenceNeeded),
  };
}

function remedyScore(p: PackAssessment) {
  const comp = p.entitlements.find((e) => e.kind === "compensation");
  if (comp?.amount && comp.confidence === "HIGH") return 3;
  if (comp) return 2;
  if (p.entitlements.some((e) => e.kind === "refund" && e.confidence === "HIGH")) return 1;
  return 0;
}

function describeRemedy(p: PackAssessment) {
  const parts: string[] = [];
  const comp = p.entitlements.find((e) => e.kind === "compensation");
  if (comp?.amount) parts.push(`compensation ${formatMoney(comp.amount)}`);
  else if (comp?.amountUpTo) parts.push(`compensation up to ${formatMoney(comp.amountUpTo)}`);
  if (p.entitlements.some((e) => e.kind === "care_hotel")) parts.push("hotel tonight");
  if (p.entitlements.some((e) => e.kind === "refund")) parts.push("refund or re-routing");
  return `${p.pack}: ${parts.join(", ") || "care while you wait"}`;
}

export function assess(input: AssessInput): RightsAssessment | null {
  const { flight, status, facts } = input;
  const packs = input.packs ?? RULE_PACKS;
  const cancelled = status.state === "cancelled" || facts?.state === "cancelled";
  const depDelay = Math.max(status.depDelayMin, 0);
  const arrDelay = Math.max(status.arrDelayMin, 0);
  if (!cancelled && depDelay < DISRUPTION_MIN && arrDelay < DISRUPTION_MIN) return null;

  const reason =
    facts?.reasonClass && facts.reasonClass !== "unknown"
      ? facts.reasonClass
      : (status.reasonClass ?? "unknown");
  const noticeAt = status.noticeAtUtc ?? facts?.noticeAtUtc ?? input.now.toISOString();
  const noticeDays = (Date.parse(flight.schedDepUtc) - Date.parse(noticeAt)) / DAY_MS;
  const ctx: Ctx = {
    flight,
    cancelled,
    depDelay,
    arrDelay,
    reason,
    noticeDays,
    overnight: overnightNeeded(flight, status, facts).needed,
    declined: input.declinedAlternative ?? false,
    facts,
    depLocalHour: localParts(flight.schedDepUtc, AIRPORTS[flight.from]?.tz ?? "UTC").hour,
  };

  const out = [
    euLike(packs.eu261, ctx),
    euLike(packs.uk261, ctx),
    usDot(packs.us_dot, ctx),
    inDgca(packs.in_dgca, ctx),
  ].filter((p): p is PackAssessment => p !== null);
  const best = [...out].sort((a, b) => remedyScore(b) - remedyScore(a))[0];
  const versions = Object.fromEntries(out.map((p) => [p.pack, packs[p.pack].version]));
  return {
    flightId: flight.id,
    packs: out,
    bestRemedy: best ? describeRemedy(best) : "none: no passenger-rights rule pack applies to this flight",
    rulePackVersions: versions,
    disclaimer: RULES_DISCLAIMER,
  };
}

/** Warn before any payment when US DOT refund rights are in play or the airline offered a voucher. */
export function needsVoucherWarning(a: RightsAssessment, facts: NoticeFacts | null): boolean {
  const usRefund = a.packs.some(
    (p) => p.pack === "us_dot" && p.entitlements.some((e) => e.kind === "refund"),
  );
  return usRefund || facts?.offeredVoucher === true;
}
