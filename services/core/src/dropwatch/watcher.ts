import {
  ROOM_RANK,
  cmp,
  formatMoney,
  sub,
  type HotelBooking,
  type Offer,
  type PolicyDecision,
  type RoomClass,
} from "@layover/shared";
import type { Clock } from "../clock";
import type { TimelineStore } from "../timeline/store";
import type { TripRepo } from "../trips/repo";
import type { SessionManager } from "../passport/session-manager";
import type { MerchantClient } from "../merchant/client";
import { gate } from "../policy/gate";
import { Rebooker, type RebookOutcome } from "./rebook";
import { REAL_HOTEL_MERCHANT, type RealHotels } from "../realdata/hotels";
import { purchaseLink } from "../realdata/buyer";

export interface WatcherDeps {
  clock: Clock;
  timeline: TimelineStore;
  trips: TripRepo;
  sessions: SessionManager;
  merchant: MerchantClient;
  rebooker: Rebooker;
  allowedOrigins: string[];
  priceCheckedThrottleMs?: number;
  /** Real-data mode: live rates for hotels booked outside Layover (watch-only). */
  realHotels?: RealHotels;
}

export interface TickResult {
  bookingId: string;
  action: "none" | "denied" | "rebooked" | "busy" | "awaiting_confirm";
  outcome?: RebookOutcome;
  decision?: PolicyDecision;
}

/** Watches active refundable bookings and rebooks through the policy gate when the price drops. */
export class DropWatcher {
  private lastChecked = new Map<string, number>();
  private lastDenied = new Map<string, string>();
  private inFlight = new Set<string>();
  /** Offers waiting for a manual "confirm" tap when auto-rebook is off. */
  readonly pending = new Map<string, Offer>();

  constructor(private d: WatcherDeps) {}

  private watchable(b: HotelBooking, now: Date) {
    return (
      b.status === "active" &&
      b.refundable &&
      !!b.cancelDeadlineUtc &&
      Date.parse(b.cancelDeadlineUtc) > now.getTime()
    );
  }

  async tick(tripId: string): Promise<TickResult[]> {
    const trip = this.d.trips.get(tripId);
    if (!trip) return [];
    const now = this.d.clock.now();
    const out: TickResult[] = [];
    for (const b of trip.hotelBookings) {
      if (b.merchantId === REAL_HOTEL_MERCHANT) {
        if (b.status === "active" && Date.parse(`${b.checkIn}T00:00:00Z`) > now.getTime())
          out.push(await this.watchReal(tripId, b));
        continue;
      }
      if (this.watchable(b, now)) out.push(await this.checkBooking(tripId, b, false));
    }
    return out;
  }

  private realAnnounced = new Map<string, number>();

  /**
   * Real hotel (booked outside Layover): check the live rate (a real Kite payment for the data) and alert on a
   * real drop. Watch-only: these hotels don't accept agent payments, so Layover never books or cancels them.
   */
  private async watchReal(tripId: string, b: HotelBooking): Promise<TickResult> {
    const real = this.d.realHotels;
    if (!real) return { bookingId: b.id, action: "none" };
    let r;
    try {
      r = await real.rate(b.hotelId, b.checkIn, b.checkOut);
    } catch (e) {
      this.d.timeline.append({
        tripId,
        type: "error",
        title: `Couldn't get the live rate for ${b.hotelName}`,
        detail: (e as Error).message,
      });
      return { bookingId: b.id, action: "none" };
    }
    if (!r.fresh) return { bookingId: b.id, action: "none" };
    const total = r.hotel.totalUsd;
    const paid = Number(b.price.amountMinor) / 100;
    const links = purchaseLink(r.purchase);
    this.d.timeline.append({
      tripId,
      type: "price_checked",
      title: `Live rate at ${b.hotelName}: ${total === null ? "not available" : `$${total.toFixed(2)}`} for your dates`,
      detail: `You paid $${paid.toFixed(2)}. Real rate bought via Kite Passport.`,
      data: { source: "x402atlas", total, paid },
      links,
    });
    const minSaving = Number(this.d.trips.get(tripId)!.settings.minSaving.amountMinor) / 100;
    if (total === null || paid - total < minSaving) return { bookingId: b.id, action: "none" };
    if (this.realAnnounced.get(b.id) === total) return { bookingId: b.id, action: "none" };
    this.realAnnounced.set(b.id, total);
    this.d.timeline.append({
      tripId,
      type: "price_drop",
      title: `${b.hotelName} is now $${total.toFixed(2)} for your dates (you paid $${paid.toFixed(2)})`,
      detail: `Real live rate: you could save $${(paid - total).toFixed(2)}. This hotel doesn't take agent payments, so rebook it yourself, then cancel your old booking.`,
      data: { source: "x402atlas", total, paid, watchOnly: true },
      links: [...(r.hotel.link ? [{ label: "Hotel site", url: r.hotel.link }] : []), ...links],
    });
    return { bookingId: b.id, action: "none" };
  }

  async confirm(tripId: string, bookingId: string): Promise<TickResult> {
    const b = this.d.trips.get(tripId)?.hotelBookings.find((x) => x.id === bookingId);
    if (!b) throw new Error(`booking ${bookingId} not found`);
    return this.checkBooking(tripId, b, true);
  }

  private async checkBooking(tripId: string, b: HotelBooking, manualConfirm: boolean): Promise<TickResult> {
    const lockKey = `${tripId}:${b.id}`;
    if (this.inFlight.has(lockKey)) return { bookingId: b.id, action: "busy" };
    this.inFlight.add(lockKey);
    try {
      return await this.check(tripId, b, manualConfirm);
    } finally {
      this.inFlight.delete(lockKey);
    }
  }

  private async check(tripId: string, b: HotelBooking, manualConfirm: boolean): Promise<TickResult> {
    const { merchant, timeline } = this.d;
    const trip = this.d.trips.get(tripId)!;
    const now = this.d.clock.now();
    const roomClass = b.roomClass ?? "standard";
    const [same, nearby] = await Promise.all([
      merchant
        .quote({ hotelId: b.hotelId, roomClass, checkIn: b.checkIn, checkOut: b.checkOut })
        .catch(() => undefined),
      merchant.hotelsNear(b.hotelId, b.checkIn, b.checkOut).catch(() => [] as Offer[]),
    ]);

    const throttle = this.d.priceCheckedThrottleMs ?? 60_000;
    if (now.getTime() - (this.lastChecked.get(b.id) ?? 0) >= throttle) {
      this.lastChecked.set(b.id, now.getTime());
      timeline.append({
        tripId,
        type: "price_checked",
        title: `Checked ${b.hotelName}: ${same ? formatMoney(same.price) : "no quote"}`,
        detail: `You paid ${formatMoney(b.price)}. ${nearby.length} nearby options compared.`,
      });
    }

    // Cheaper offers only; best first (cheapest, then highest rating). Same-hotel offer carries no distance.
    const distanceOf = new Map(nearby.map((o) => [`${o.hotelId}|${o.roomClass}`, o.distanceKm ?? null]));
    // Alternatives must look like a like-for-like swap before we even call it a "drop"; the gate re-checks all of it.
    const rank = (rc?: string) => (rc && rc in ROOM_RANK ? ROOM_RANK[rc as RoomClass] : -1);
    const comparable = nearby.filter(
      (o) =>
        o.hotelId !== b.hotelId &&
        o.refundable &&
        (o.rating ?? 0) >= (b.rating ?? 0) &&
        (o.distanceKm ?? Infinity) <= 2 &&
        rank(o.roomClass) >= rank(b.roomClass),
    );
    const candidates = [...(same ? [same] : []), ...comparable]
      .filter((o) => o.price.currency === b.price.currency && cmp(o.price, b.price) < 0)
      .sort((x, y) => cmp(x.price, y.price) || (y.rating ?? 0) - (x.rating ?? 0));
    if (candidates.length === 0) return { bookingId: b.id, action: "none" };

    const session = this.d.sessions.current(tripId);
    const spent = this.d.sessions.spentTotal(tripId);
    const decide = (o: Offer) =>
      gate({
        action: "rebook",
        now,
        ...(session && { session }),
        spentTotal: spent,
        offer: o,
        settings: trip.settings,
        allowedOrigins: this.d.allowedOrigins,
        manualConfirm,
        booking: b,
        distanceFromBookedKm:
          o.hotelId === b.hotelId ? 0 : (distanceOf.get(`${o.hotelId}|${o.roomClass}`) ?? null),
      });
    const decisions = candidates.map((o) => ({ o, d: decide(o) }));
    const chosen = decisions.find((x) => x.d.allow) ?? decisions[0]!;
    const { o: offer, d: decision } = chosen;

    // A rebook to this exact offer already ran (or is running): stay quiet, don't re-announce it every tick.
    if (decision.allow && this.d.rebooker.state(Rebooker.idemKey(tripId, b.id, offer))) {
      return { bookingId: b.id, action: "busy", decision };
    }
    // Announce each distinct drop once (avoid spamming the timeline every tick).
    const sig = `${offer.hotelId}|${offer.price.amountMinor}|${decision.allow}|${decision.reasons.join(",")}`;
    if (!decision.allow && this.lastDenied.get(b.id) === sig)
      return { bookingId: b.id, action: "denied", decision };

    timeline.append({
      tripId,
      type: "price_drop",
      title: `${offer.hotelName} is now ${formatMoney(offer.price)} (you paid ${formatMoney(b.price)})`,
      detail: `Possible saving ${formatMoney(sub(b.price, offer.price))}.`,
      data: { offer },
    });
    timeline.append({
      tripId,
      type: "policy_decision",
      title: decision.allow
        ? "Policy check passed: rebooking"
        : `Policy check: not rebooking (${decision.reasons.join(", ")})`,
      data: decision as unknown as Record<string, unknown>,
    });

    if (!decision.allow) {
      this.lastDenied.set(b.id, sig);
      if (decision.reasons.length === 1 && decision.reasons[0] === "consent") {
        this.pending.set(`${tripId}:${b.id}`, offer);
        return { bookingId: b.id, action: "awaiting_confirm", decision };
      }
      return { bookingId: b.id, action: "denied", decision };
    }
    this.lastDenied.delete(b.id);
    this.pending.delete(`${tripId}:${b.id}`);
    const key = Rebooker.idemKey(tripId, b.id, offer);
    if (!this.d.rebooker.claim(key, tripId)) return { bookingId: b.id, action: "busy", decision };
    const outcome = await this.d.rebooker.run(tripId, b, offer, key);
    return { bookingId: b.id, action: "rebooked", outcome, decision };
  }
}
