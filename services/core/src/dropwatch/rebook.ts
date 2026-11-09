import {
  formatMoney,
  minorOf,
  money,
  pct,
  sub,
  toAtomic,
  type HotelBooking,
  type Offer,
  type RoomClass,
} from "@layover/shared";
import type { Clock } from "../clock";
import type { Db } from "../db";
import type { TimelineStore } from "../timeline/store";
import type { TripRepo } from "../trips/repo";
import type { SessionManager } from "../passport/session-manager";
import type { MerchantClient } from "../merchant/client";
import type { ChainVerifier } from "../chain/verify";
import { PassportError } from "../passport/errors";

export type RebookState =
  | "PAYING"
  | "BOOKED"
  | "CANCELLING"
  | "REFUND_PENDING"
  | "DONE"
  | "FAILED_PAY"
  | "FAILED_CANCEL"
  | "FAILED_REFUND";

export const FEE_BPS = 3000; // Layover keeps 30 % of the saving

export interface RebookDeps {
  db: Db;
  clock: Clock;
  timeline: TimelineStore;
  trips: TripRepo;
  sessions: SessionManager;
  merchant: MerchantClient;
  chain: ChainVerifier;
  /** Where refunds go: the traveler's Passport wallet. */
  refundTo: () => Promise<string>;
  merchantWallet: string;
  token: { address: string; decimals: number };
  priceScale: number;
  sleep?: (ms: number) => Promise<void>;
  refundPollMs?: number;
  refundAlertAfterMs?: number;
  refundGiveUpAfterMs?: number;
}

export interface RebookOutcome {
  state: RebookState;
  newBookingId?: string;
  paymentTx?: string;
  refundTx?: string;
}

/**
 * The safe rebook state machine (TDD §8.2): PAYING → BOOKED → CANCELLING → REFUND_PENDING → DONE.
 * Never cancels the old booking before the new one is paid and confirmed.
 */
export class Rebooker {
  private sleep: (ms: number) => Promise<void>;
  constructor(private d: RebookDeps) {
    this.sleep = d.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  static idemKey(tripId: string, bookingId: string, offer: Offer) {
    return `${tripId}:${bookingId}:${offer.hotelId}-${offer.roomClass ?? "std"}-${offer.rateTier ?? minorOf(offer.price)}`;
  }

  private setState(key: string, tripId: string, state: RebookState, data: object) {
    this.d.db
      .query(
        "INSERT INTO rebooks (idemKey, tripId, state, json, updatedAt) VALUES (?, ?, ?, ?, ?) ON CONFLICT(idemKey) DO UPDATE SET state = excluded.state, json = excluded.json, updatedAt = excluded.updatedAt",
      )
      .run(key, tripId, state, JSON.stringify(data), this.d.clock.now().toISOString());
  }

  /** Claims the idempotency key; false if this rebook already ran (or is running). */
  claim(key: string, tripId: string): boolean {
    const r = this.d.db
      .query(
        "INSERT INTO rebooks (idemKey, tripId, state, json, updatedAt) VALUES (?, ?, 'PAYING', '{}', ?) ON CONFLICT(idemKey) DO NOTHING",
      )
      .run(key, tripId, this.d.clock.now().toISOString());
    return r.changes === 1;
  }

  state(key: string): RebookState | undefined {
    return this.d.db
      .query<{ state: RebookState }, [string]>("SELECT state FROM rebooks WHERE idemKey = ?")
      .get(key)?.state;
  }

  async run(tripId: string, old: HotelBooking, offer: Offer, key: string): Promise<RebookOutcome> {
    const { timeline, trips, merchant } = this.d;
    const refundTo = await this.d.refundTo();
    const ev = (e: Parameters<TimelineStore["append"]>[0]) => timeline.append(e);

    // ---- PAYING ----
    let pay;
    try {
      pay = await this.d.sessions.pay(tripId, {
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
      this.setState(key, tripId, "FAILED_PAY", { error: (e as Error).message });
      if (!(e instanceof PassportError && e.sessionFatal)) {
        ev({
          tripId,
          type: "error",
          title: "New booking failed, your current booking is unchanged",
          detail: e instanceof PassportError ? e.hint : (e as Error).message,
        });
      }
      return { state: "FAILED_PAY" };
    }
    if (pay.status >= 400 || !pay.payment) {
      this.setState(key, tripId, "FAILED_PAY", { status: pay.status });
      const reason =
        pay.status === 409 ? "the price changed before booking" : `merchant answered ${pay.status}`;
      ev({
        tripId,
        type: "error",
        title: "New booking not made, your current booking is unchanged",
        detail: `Nothing was charged: ${reason}.`,
      });
      return { state: "FAILED_PAY" };
    }
    const tx = pay.payment.tx;
    const body = pay.body as { confirmation?: string; cancelDeadlineUtc?: string };
    const newId = `hb_${crypto.randomUUID().slice(0, 8)}`;
    const nb: HotelBooking = {
      id: newId,
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
      paymentTx: tx ?? null,
      payer: refundTo,
      status: "active",
    };
    trips.update(tripId, (t) => ({ ...t, hotelBookings: [...t.hotelBookings, nb] }));
    const txLinks = tx ? [{ label: "Payment on KiteScan", url: this.d.chain.explorerTx(tx) }] : [];
    ev({
      tripId,
      type: "payment",
      title: `Paid ${formatMoney(offer.price)} via Kite Passport`,
      detail: `New booking at ${offer.hotelName}, ${offer.checkIn} → ${offer.checkOut}.`,
      data: { tx, amount: offer.price, settled: pay.payment.amount, asset: pay.payment.asset },
      links: txLinks,
    });
    ev({
      tripId,
      type: "booking_confirmed",
      title: `Booked ${offer.hotelName} · ${body.confirmation ?? "confirmed"}`,
      detail: `Your old booking ${old.confirmation ?? old.id} is cancelled only now that the new one is confirmed.`,
      data: { bookingId: newId, confirmation: body.confirmation },
    });
    this.setState(key, tripId, "BOOKED", { newBookingId: newId, tx });

    // ---- CANCELLING (only after BOOKED) ----
    this.setState(key, tripId, "CANCELLING", { newBookingId: newId, tx });
    const c = old.confirmation
      ? await merchant
          .cancel(old.confirmation, refundTo)
          .catch((e: Error) => ({ ok: false as const, status: 0, error: e.message }))
      : { ok: false as const, status: 0, error: "no confirmation number" };
    if (!c.ok) {
      this.setState(key, tripId, "FAILED_CANCEL", { newBookingId: newId, tx, error: c.error });
      ev({
        tripId,
        type: "error",
        title: "Couldn't cancel your old booking, you now hold both",
        detail: `Cancel ${old.hotelName} (${old.confirmation ?? old.id}) manually before ${old.cancelDeadlineUtc ?? "its deadline"} to get your refund. Reason: ${c.error}.`,
        data: { bookingId: old.id, deadline: old.cancelDeadlineUtc },
      });
      return { state: "FAILED_CANCEL", newBookingId: newId, ...(tx && { paymentTx: tx }) };
    }
    trips.update(tripId, (t) => ({
      ...t,
      hotelBookings: t.hotelBookings.map((b) =>
        b.id === old.id ? { ...b, status: "replaced" as const } : b,
      ),
    }));
    ev({
      tripId,
      type: "cancel_requested",
      title: `Cancelled ${old.hotelName} ${old.confirmation ?? ""}`.trim(),
      detail: `Refund of ${formatMoney(old.price)} sent by the hotel; checking it on-chain.`,
      data: { refundTx: c.refundTx },
      links: [{ label: "Refund on KiteScan", url: this.d.chain.explorerTx(c.refundTx) }],
    });

    // ---- REFUND_PENDING ----
    this.setState(key, tripId, "REFUND_PENDING", { newBookingId: newId, tx, refundTx: c.refundTx });
    const saving = sub(old.price, offer.price);
    const fee = money(pct(minorOf(saving), FEE_BPS), saving.currency);
    const keep = sub(saving, fee);
    const amountAtomic = c.amountAtomic
      ? BigInt(c.amountAtomic)
      : toAtomic(minorOf(old.price), this.d.token.decimals, this.d.priceScale);
    const expectation = {
      token: this.d.token.address,
      from: this.d.merchantWallet,
      to: refundTo,
      amountAtomic,
    };
    const poll = this.d.refundPollMs ?? 5_000;
    const alertAfter = this.d.refundAlertAfterMs ?? 120_000;
    const giveUp = this.d.refundGiveUpAfterMs ?? 30 * 60_000;
    const started = this.d.clock.now().getTime();
    let alerted = false;
    for (;;) {
      const ok = await this.d.chain.verifyRefund(c.refundTx as `0x${string}`, expectation).catch(() => false);
      if (ok) {
        this.setState(key, tripId, "DONE", { newBookingId: newId, tx, refundTx: c.refundTx });
        ev({
          tripId,
          type: "refund_verified",
          title: `Saved ${formatMoney(saving)} · fee ${formatMoney(fee)}`,
          detail: `Refund of ${formatMoney(old.price)} verified on-chain. You keep ${formatMoney(keep)}.`,
          data: { saving, fee, keep, refundTx: c.refundTx },
          links: [{ label: "Refund on KiteScan", url: this.d.chain.explorerTx(c.refundTx) }],
        });
        return { state: "DONE", newBookingId: newId, ...(tx && { paymentTx: tx }), refundTx: c.refundTx };
      }
      const elapsed = this.d.clock.now().getTime() - started;
      if (!alerted && elapsed >= alertAfter) {
        alerted = true;
        ev({
          tripId,
          type: "error",
          title: "Refund pending",
          detail: `The hotel's refund of ${formatMoney(old.price)} isn't confirmed on-chain yet. Layover keeps checking for 30 minutes.`,
          data: { refundTx: c.refundTx },
        });
      }
      if (elapsed >= giveUp) {
        this.setState(key, tripId, "FAILED_REFUND", { newBookingId: newId, tx, refundTx: c.refundTx });
        return { state: "FAILED_REFUND", newBookingId: newId, refundTx: c.refundTx };
      }
      await this.sleep(poll);
    }
  }
}
