import {
  ROOM_RANK,
  add,
  cmp,
  formatMoney,
  minorOf,
  sub,
  type HotelBooking,
  type Money,
  type Offer,
  type PolicyCheck,
  type PolicyDecision,
  type RoomClass,
  type TripSettings,
} from "@layover/shared";

/**
 * The only place that can say "spend" (TDD §9). PURE: no I/O, `now` is passed in.
 * `allow` requires every check to pass; every check is reported, passing or not.
 */
export interface GateInput {
  action: "rebook" | "rescue_hotel";
  now: Date;
  session?: { status: string; ttlUntilUtc: string; maxPerTx: Money; maxTotal: Money };
  spentTotal: Money;
  offer: Offer;
  settings: TripSettings;
  allowedOrigins: string[];
  manualConfirm?: boolean;
  /** Rebook only: the booking being replaced. */
  booking?: HotelBooking;
  /** Rebook only, other hotel: distance from the booked hotel. */
  distanceFromBookedKm?: number | null;
  /** Rescue only. */
  disruption?: { overnightNeeded: boolean; nightDate: string };
}

const REBOOK_MAX_KM_FROM_BOOKED = 2;
const CANCEL_MARGIN_MS = 2 * 3600 * 1000;

const originOf = (url: string) => {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
};
const rank = (rc: string | undefined) => (rc && rc in ROOM_RANK ? ROOM_RANK[rc as RoomClass] : -1);

export function gate(input: GateInput): PolicyDecision {
  const { offer, settings, session, now } = input;
  const checks: PolicyCheck[] = [];
  const check = (name: string, pass: boolean, detail: string) => checks.push({ name, pass, detail });
  const amount = offer.price;
  const usdSession = session?.maxPerTx.currency ?? "USD";
  const sameCurrency = amount.currency === usdSession;

  // ---- common ----
  const ttlOk = !!session && session.status === "active" && now.getTime() < Date.parse(session.ttlUntilUtc);
  check(
    "session_active",
    ttlOk,
    session
      ? `${session.status}, valid until ${session.ttlUntilUtc}`
      : "no Kite session approved for this trip",
  );
  check("amount_positive", minorOf(amount) > 0n, formatMoney(amount));
  check("currency", sameCurrency, `${amount.currency} vs session ${usdSession}`);
  const origin = originOf(offer.payUrl);
  check(
    "merchant_origin",
    origin !== "" && input.allowedOrigins.includes(origin),
    origin
      ? `${origin}${input.allowedOrigins.includes(origin) ? " is allowed" : " is not an allowed merchant"}`
      : "invalid pay URL",
  );

  if (session && sameCurrency) {
    const perTxLimit =
      input.action === "rescue_hotel" && cmp(settings.maxPerBooking, session.maxPerTx) < 0
        ? settings.maxPerBooking
        : session.maxPerTx;
    check("max_per_tx", cmp(amount, perTxLimit) <= 0, `${formatMoney(amount)} ≤ ${formatMoney(perTxLimit)}`);
    const after = add(input.spentTotal, amount);
    check(
      "max_total",
      cmp(after, session.maxTotal) <= 0,
      `${formatMoney(amount)} + ${formatMoney(input.spentTotal)} spent ≤ ${formatMoney(session.maxTotal)}`,
    );
  } else {
    check("max_per_tx", false, session ? "currency mismatch" : "no session");
    check("max_total", false, session ? "currency mismatch" : "no session");
  }

  if (input.action === "rebook") {
    check(
      "consent",
      settings.autoRebook || input.manualConfirm === true,
      settings.autoRebook
        ? "auto-rebook is on"
        : input.manualConfirm
          ? "confirmed by you"
          : "auto-rebook is off; waiting for your tap",
    );
    const b = input.booking;
    if (!b) {
      check("same_dates", false, "no booking to replace");
    } else {
      check(
        "same_dates",
        offer.checkIn === b.checkIn && offer.checkOut === b.checkOut,
        `${offer.checkIn}→${offer.checkOut} vs booked ${b.checkIn}→${b.checkOut}`,
      );
      check(
        "room_class",
        rank(offer.roomClass) >= rank(b.roomClass),
        `${offer.roomClass ?? "unknown"} ≥ ${b.roomClass ?? "unknown"}`,
      );
      if (offer.hotelId === b.hotelId) {
        check("hotel_quality", true, "same hotel");
      } else {
        const r = offer.rating ?? 0;
        const br = b.rating ?? 0;
        check("rating", r >= br, `${r}★ vs booked ${br}★`);
        const km = input.distanceFromBookedKm;
        check(
          "distance",
          km != null && km <= REBOOK_MAX_KM_FROM_BOOKED,
          km == null ? "distance unknown" : `${km} km from your hotel (max ${REBOOK_MAX_KM_FROM_BOOKED} km)`,
        );
      }
      check("refundable", offer.refundable, offer.refundable ? "free cancellation" : "non-refundable");
      const deadline = b.cancelDeadlineUtc ? Date.parse(b.cancelDeadlineUtc) : NaN;
      check(
        "cancel_window",
        Number.isFinite(deadline) && now.getTime() < deadline - CANCEL_MARGIN_MS,
        b.cancelDeadlineUtc
          ? `old booking cancellable until ${b.cancelDeadlineUtc} (2 h margin)`
          : "no cancel deadline",
      );
      if (sameCurrency && b.price.currency === amount.currency) {
        const saving = sub(b.price, amount);
        check(
          "min_saving",
          cmp(saving, settings.minSaving) >= 0,
          `${formatMoney(saving)} ≥ ${formatMoney(settings.minSaving)}`,
        );
      } else {
        check("min_saving", false, "currency mismatch");
      }
    }
  } else {
    check(
      "consent",
      settings.autoRescue || input.manualConfirm === true,
      settings.autoRescue
        ? "auto-rescue is on"
        : input.manualConfirm
          ? "confirmed by you"
          : "auto-rescue is off; waiting for your tap",
    );
    const dis = input.disruption;
    check(
      "overnight",
      dis?.overnightNeeded === true,
      dis?.overnightNeeded ? "overnight stay needed" : "no overnight stay needed",
    );
    const km = offer.distanceKm;
    check(
      "distance",
      km != null && km <= settings.maxHotelDistanceKm,
      km == null ? "distance unknown" : `${km} km from the airport (max ${settings.maxHotelDistanceKm} km)`,
    );
    const r = offer.rating ?? 0;
    check("rating", r >= settings.minRating, `${r}★ (min ${settings.minRating}★)`);
    check("refundable", offer.refundable, offer.refundable ? "free cancellation" : "non-refundable");
    check(
      "date",
      !!dis && offer.checkIn === dis.nightDate,
      `check-in ${offer.checkIn}${dis ? ` vs disruption night ${dis.nightDate}` : ""}`,
    );
  }

  const reasons = checks.filter((c) => !c.pass).map((c) => c.name);
  return { allow: reasons.length === 0, action: input.action, checks, reasons };
}
