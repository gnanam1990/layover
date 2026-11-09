import {
  formatMoney,
  minorOf,
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
import type { ServClient } from "../serv/client";
import type { ChainVerifier } from "../chain/verify";
import type { DisruptionInfo } from "../disruption/detector";
import { PassportError } from "../passport/errors";
import { optionRank } from "../serv/prompts/optionRank";
import { gate } from "../policy/gate";
import { rankOptions } from "./options";

export interface RescueDeps {
  clock: Clock;
  timeline: TimelineStore;
  trips: TripRepo;
  sessions: SessionManager;
  merchant: MerchantClient;
  serv: ServClient;
  chain: ChainVerifier;
  allowedOrigins: string[];
  refundTo: () => Promise<string>;
  /** M09: builds the claim pack once the rescue is done (or not needed). */
  buildClaim: (info: DisruptionInfo) => Promise<void>;
}

interface Pending {
  info: DisruptionInfo;
  options: Offer[];
}

const nextDay = (d: string) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + 1);
  return x.toISOString().slice(0, 10);
};

/** Act 2 (TDD §8.3): voucher warning first, then a hotel near the origin airport inside the trip limits. */
export class RescueOrchestrator {
  private pending = new Map<string, Pending>();
  constructor(private d: RescueDeps) {}

  pendingFor(tripId: string): Pending | undefined {
    return this.pending.get(tripId);
  }

  async handle(info: DisruptionInfo): Promise<void> {
    const { timeline } = this.d;
    const { tripId } = info;
    if (info.voucherWarning) this.voucherWarning(info);
    if (!info.overnightNeeded) {
      await this.d.buildClaim(info);
      return;
    }
    const all = await this.d.merchant
      .hotelsNear(info.origin, info.nightDate, nextDay(info.nightDate))
      .catch(() => [] as Offer[]);
    const options = rankOptions(all);
    const why = await optionRank(
      this.d.serv,
      options,
      `Flight ${info.flight.carrier}${info.flight.number} cancelled; traveler needs a hotel near ${info.origin} tonight.`,
    ).catch(() => options.map(() => ""));
    const decisions = options.map((o) => ({ o, d: this.decide(info, o, false) }));
    const allowed = decisions.find((x) => x.d.allow);
    if (allowed) {
      await this.book(info, allowed.o, allowed.d, why[options.indexOf(allowed.o)] ?? "");
      return;
    }
    const consentOnly = decisions.find((x) => x.d.reasons.length === 1 && x.d.reasons[0] === "consent");
    if (consentOnly) {
      const ok = decisions.filter((x) => x.d.reasons.every((r) => r === "consent")).map((x) => x.o);
      this.pending.set(tripId, { info, options: ok });
      timeline.append({
        tripId,
        type: "policy_decision",
        title: `Tap to confirm ${consentOnly.o.hotelName} for tonight (${formatMoney(consentOnly.o.price)})`,
        detail: `${consentOnly.o.distanceKm} km from ${info.origin}, ${consentOnly.o.rating}★, free cancellation. Auto-rescue is off, so Layover waits for you.`,
        data: { ...consentOnly.d, options: ok, why } as unknown as Record<string, unknown>,
      });
      return;
    }
    const best = decisions[0];
    timeline.append({
      tripId,
      type: "error",
      title: "No hotel within your limits",
      detail: best
        ? `The best option, ${best.o.hotelName} at ${formatMoney(best.o.price)}, failed: ${best.d.reasons.join(", ")}. Approve a new session with a higher per-booking limit, or book yourself and keep the receipt.`
        : `No refundable hotel found near ${info.origin}. Book yourself and keep the receipt; approve a new session if you want Layover to pay.`,
      data: { decisions: decisions.map((x) => ({ hotelId: x.o.hotelId, reasons: x.d.reasons })) },
    });
    await this.d.buildClaim(info);
  }

  async confirm(tripId: string, hotelId: string): Promise<{ booked: boolean; reasons?: string[] }> {
    const p = this.pending.get(tripId);
    const offer = p?.options.find((o) => o.hotelId === hotelId);
    if (!p || !offer) return { booked: false, reasons: ["no_pending_offer"] };
    const d = this.decide(p.info, offer, true);
    if (!d.allow) return { booked: false, reasons: d.reasons };
    this.pending.delete(tripId);
    const ok = await this.book(p.info, offer, d, "");
    return { booked: ok };
  }

  private decide(info: DisruptionInfo, offer: Offer, manualConfirm: boolean): PolicyDecision {
    const trip = this.d.trips.get(info.tripId)!;
    const session = this.d.sessions.current(info.tripId);
    return gate({
      action: "rescue_hotel",
      now: this.d.clock.now(),
      ...(session && { session }),
      spentTotal: this.d.sessions.spentTotal(info.tripId),
      offer,
      settings: trip.settings,
      allowedOrigins: this.d.allowedOrigins,
      manualConfirm,
      disruption: { overnightNeeded: info.overnightNeeded, nightDate: info.nightDate },
    });
  }

  private voucherWarning(info: DisruptionInfo) {
    const a = info.assessment;
    const us = a.packs.find((p) => p.pack === "us_dot" && p.doNot.length);
    const first = us ?? a.packs.find((p) => p.doNot.length);
    const offered = info.facts?.offeredVoucher;
    const action = a.packs.flatMap((p) => p.actions)[0] ?? "";
    this.d.timeline.append({
      tripId: info.tripId,
      type: "voucher_warning",
      title: first?.doNot[0] ?? "Don't accept a voucher if you want cash",
      detail: `${offered ? "The airline offered a voucher. " : ""}${action}`.trim(),
      data: { packs: a.packs.map((p) => p.pack), offeredVoucher: offered ?? false },
    });
  }

  private async book(
    info: DisruptionInfo,
    offer: Offer,
    decision: PolicyDecision,
    why: string,
  ): Promise<boolean> {
    const { timeline, trips } = this.d;
    const { tripId } = info;
    timeline.append({
      tripId,
      type: "policy_decision",
      title: `Policy check passed: booking ${offer.hotelName}`,
      detail: why || undefined,
      data: decision as unknown as Record<string, unknown>,
    });
    const refundTo = await this.d.refundTo();
    const key = `${tripId}:rescue:${info.flight.id}:${offer.hotelId}`;
    let r;
    try {
      r = await this.d.sessions.pay(tripId, {
        url: offer.payUrl,
        body: {
          hotelId: offer.hotelId,
          roomClass: offer.roomClass,
          checkIn: offer.checkIn,
          checkOut: offer.checkOut,
          refundTo,
        },
        idempotencyKey: key,
        displayAmountMinor: minorOf(offer.price),
      });
    } catch (e) {
      if (!(e instanceof PassportError && e.sessionFatal)) {
        timeline.append({
          tripId,
          type: "error",
          title: "Hotel payment failed",
          detail: e instanceof PassportError ? e.hint : (e as Error).message,
        });
      }
      await this.d.buildClaim(info);
      return false;
    }
    if (r.status >= 400 || !r.payment) {
      timeline.append({
        tripId,
        type: "error",
        title: "Hotel booking failed, nothing was charged",
        detail: `The hotel answered ${r.status}.`,
      });
      await this.d.buildClaim(info);
      return false;
    }
    const tx = r.payment.tx ?? "";
    const explorerUrl = tx ? this.d.chain.explorerTx(tx) : "";
    const body = r.body as { confirmation?: string; cancelDeadlineUtc?: string };
    const receipt = {
      desc: `Hotel ${offer.hotelName}, night of ${offer.checkIn} (${info.flight.carrier}${info.flight.number} cancelled)`,
      amount: offer.price,
      tx,
      explorerUrl,
    };
    const hb: HotelBooking = {
      id: `hb_${crypto.randomUUID().slice(0, 8)}`,
      merchantId: offer.merchantId,
      hotelId: offer.hotelId,
      hotelName: offer.hotelName,
      ...(offer.rating !== undefined && { rating: offer.rating }),
      ...(offer.roomClass && { roomClass: offer.roomClass as RoomClass }),
      checkIn: offer.checkIn,
      checkOut: offer.checkOut,
      price: offer.price,
      refundable: offer.refundable,
      ...((body.cancelDeadlineUtc ?? offer.cancelDeadlineUtc) && {
        cancelDeadlineUtc: body.cancelDeadlineUtc ?? offer.cancelDeadlineUtc,
      }),
      ...(body.confirmation && { confirmation: body.confirmation }),
      paymentTx: tx || null,
      payer: refundTo,
      status: "active",
    };
    trips.update(tripId, (t) => ({ ...t, hotelBookings: [...t.hotelBookings, hb] }));
    timeline.append({
      tripId,
      type: "payment",
      title: `Paid ${formatMoney(offer.price)} via Kite Passport`,
      detail: `Tonight's hotel from your emergency budget.`,
      data: { tx, amount: offer.price, settled: r.payment.amount },
      links: explorerUrl ? [{ label: "Payment on KiteScan", url: explorerUrl }] : [],
    });
    timeline.append({
      tripId,
      type: "rescue_booked",
      title: `Booked ${offer.hotelName} for tonight · ${body.confirmation ?? ""}`.trim(),
      detail: `${offer.distanceKm} km from ${info.origin}, ${offer.rating}★, free cancellation. Receipt saved for your claim.`,
      data: { bookingId: hb.id, receipt, why },
      links: explorerUrl ? [{ label: "Receipt on KiteScan", url: explorerUrl }] : [],
    });
    await this.d.buildClaim(info);
    return true;
  }
}
