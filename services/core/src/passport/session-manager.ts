import { add, formatMoney, minorOf, money, SessionRecord, type Money } from "@layover/shared";
import type { Db } from "../db";
import type { Clock } from "../clock";
import type { TimelineStore } from "../timeline/store";
import type { TripRepo } from "../trips/repo";
import { settledUsd, type ExecuteResult, type PassportAdapter } from "./adapter";
import { PassportError, mapKpassError } from "./errors";

export interface PayRequest {
  url: string;
  method?: "GET" | "POST";
  body?: unknown;
  idempotencyKey: string;
  /** Price in display minor units (e.g. 7200 = $72.00); recorded for the spend meter. */
  displayAmountMinor: bigint;
  bookingId?: string;
}

export interface SessionDeps {
  db: Db;
  clock: Clock;
  timeline: TimelineStore;
  passport: PassportAdapter;
  trips: TripRepo;
  priceScale: number;
  merchantUrl: string;
}

/**
 * One Kite Passport session per trip (TDD §5): maxPerTx = maxPerBooking, maxTotal = emergencyBudget + maxPerBooking,
 * TTL = checkout + 24 h. After any cap/scope/expiry error the session is never used again.
 */
export class SessionManager {
  constructor(private d: SessionDeps) {}

  current(tripId: string): SessionRecord | undefined {
    const row = this.d.db
      .query<{ json: string }, [string]>(
        "SELECT json FROM sessions WHERE tripId = ? ORDER BY updatedAt DESC, rowid DESC LIMIT 1",
      )
      .get(tripId);
    return row ? SessionRecord.parse(JSON.parse(row.json)) : undefined;
  }

  private put(tripId: string, rec: SessionRecord) {
    this.d.db
      .query(
        "INSERT INTO sessions (id, tripId, json, updatedAt) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json, updatedAt = excluded.updatedAt",
      )
      .run(rec.id, tripId, JSON.stringify(rec), this.d.clock.now().toISOString());
  }

  async protectTrip(tripId: string): Promise<SessionRecord> {
    const trip = this.d.trips.get(tripId);
    if (!trip) throw new Error(`trip ${tripId} not found`);
    const s = trip.settings;
    const maxPerTx: Money = s.maxPerBooking;
    const maxTotal: Money = add(s.emergencyBudget, s.maxPerBooking);
    const lastCheckout = [
      ...trip.hotelBookings.map((b) => b.checkOut),
      ...trip.flights.map((f) => f.schedArrUtc.slice(0, 10)),
    ]
      .sort()
      .at(-1);
    const ttlUntil = new Date(`${lastCheckout ?? this.d.clock.now().toISOString().slice(0, 10)}T00:00:00Z`);
    ttlUntil.setUTCDate(ttlUntil.getUTCDate() + 1);
    const ttlSeconds = Math.max(3600, Math.floor((ttlUntil.getTime() - this.d.clock.now().getTime()) / 1000));
    const dates = trip.hotelBookings[0]
      ? `${trip.hotelBookings[0].checkIn}–${trip.hotelBookings[0].checkOut}`
      : "";
    const host = new URL(this.d.merchantUrl).host;

    const req = await this.d.passport.requestSession({
      taskSummary:
        `Layover trip ${trip.id}: hotel rebooks and disruption care for ${trip.travelerName} ${dates}`.trim(),
      maxPerTx: settledUsd(minorOf(maxPerTx), this.d.priceScale),
      maxTotal: settledUsd(minorOf(maxTotal), this.d.priceScale),
      ttlSeconds,
      allowedEndpoints: [{ method: "POST", host, path_prefix: "/v1/book/" }],
    });
    const rec: SessionRecord = {
      id: req.requestId,
      requestId: req.requestId,
      purpose: "trip",
      maxPerTx,
      maxTotal,
      ttlUntilUtc: ttlUntil.toISOString(),
      status: "requested",
      approvalUrl: req.approvalUrl,
    };
    this.put(tripId, rec);
    this.d.timeline.append({
      tripId,
      type: "session_requested",
      title: "Approve your trip limits with your passkey",
      detail: `Up to ${formatMoney(maxPerTx)} per booking and ${formatMoney(maxTotal)} in total, until ${rec.ttlUntilUtc.slice(0, 10)}.`,
      data: { requestId: req.requestId, priceScale: this.d.priceScale, payer: this.d.passport.kind },
      links: [{ label: "Approve in Kite Passport", url: req.approvalUrl }],
    });
    return rec;
  }

  /** Waits for the passkey approval; call in the background after protectTrip. */
  async waitForApproval(tripId: string, timeoutMs: number): Promise<SessionRecord> {
    const rec = this.current(tripId);
    if (!rec) throw new Error(`no session requested for ${tripId}`);
    const r = await this.d.passport.awaitSession(rec.requestId, timeoutMs);
    if (r.status === "timeout") return rec;
    const next: SessionRecord = {
      ...rec,
      id: r.sessionId ?? rec.id,
      status: r.status === "active" ? "active" : "rejected",
      ...(r.expiresAt && { ttlUntilUtc: r.expiresAt }),
    };
    this.d.db.query("DELETE FROM sessions WHERE id = ?").run(rec.id);
    this.put(tripId, next);
    if (next.status === "active") {
      this.d.trips.update(tripId, (t) => ({ ...t, status: "protected" }));
      this.d.timeline.append({
        tripId,
        type: "session_active",
        title: "Protected",
        detail: `Kite Passport session active until ${next.ttlUntilUtc.slice(0, 16).replace("T", " ")} UTC.`,
        data: { sessionId: next.id },
      });
    } else {
      this.d.timeline.append({
        tripId,
        type: "error",
        title: "Session not approved",
        detail: "The passkey request was rejected.",
      });
    }
    return next;
  }

  spentTotalMinor(tripId: string): bigint {
    const rows = this.d.db
      .query<{ amountMinor: string }, [string]>("SELECT amountMinor FROM payments WHERE tripId = ?")
      .all(tripId);
    return rows.reduce((acc, r) => acc + BigInt(r.amountMinor), 0n);
  }

  spentTotal(tripId: string): Money {
    return money(this.spentTotalMinor(tripId), "USD");
  }

  async pay(tripId: string, p: PayRequest): Promise<ExecuteResult> {
    const rec = this.current(tripId);
    const now = this.d.clock.now().toISOString();
    if (!rec || rec.status !== "active" || now >= rec.ttlUntilUtc) {
      const code = rec?.status === "exhausted" ? "session_total_exceeded" : "session_forbidden";
      throw mapKpassError({ error_code: code }, 6);
    }
    try {
      const r = await this.d.passport.execute({
        url: p.url,
        method: p.method ?? "POST",
        ...(p.body !== undefined && { body: p.body }),
        idempotencyKey: p.idempotencyKey,
        sessionId: rec.id,
      });
      if (r.payment) {
        this.d.db
          .query(
            `INSERT INTO payments (id, tripId, bookingId, idemKey, amountMinor, currency, tx, network, atUtc)
             VALUES (?, ?, ?, ?, ?, 'USD', ?, ?, ?) ON CONFLICT(idemKey) DO NOTHING`,
          )
          .run(
            crypto.randomUUID(),
            tripId,
            p.bookingId ?? null,
            p.idempotencyKey,
            p.displayAmountMinor.toString(),
            r.payment.tx ?? null,
            r.payment.chainId ? `eip155:${r.payment.chainId}` : null,
            now,
          );
      }
      return r;
    } catch (e) {
      if (e instanceof PassportError && e.sessionFatal) {
        const status = e.code === "session_forbidden" ? "expired" : "exhausted";
        this.put(tripId, { ...rec, status });
        this.d.timeline.append({
          tripId,
          type: "error",
          title: "Payment stopped by your Kite session limits",
          detail: `${e.hint} Approve a new session with at least ${formatMoney(money(p.displayAmountMinor, "USD"))} per booking.`,
          data: { code: e.code },
        });
      }
      throw e;
    }
  }
}
