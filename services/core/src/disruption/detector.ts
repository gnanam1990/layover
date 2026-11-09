import type { Flight, FlightStatus, NoticeFacts, RightsAssessment } from "@layover/shared";
import type { Clock } from "../clock";
import type { Db } from "../db";
import type { TimelineStore } from "../timeline/store";
import type { TripRepo } from "../trips/repo";
import type { MerchantClient } from "../merchant/client";
import type { ServClient } from "../serv/client";
import { assess, needsVoucherWarning, overnightNeeded } from "../rights/engine";
import { explainRights, parseNotice } from "./notice";

export interface DisruptionInfo {
  tripId: string;
  flight: Flight;
  status: FlightStatus;
  facts: NoticeFacts | null;
  assessment: RightsAssessment;
  assessmentId: string;
  overnightNeeded: boolean;
  nightDate: string;
  origin: string;
  voucherWarning: boolean;
}

export interface DetectorDeps {
  clock: Clock;
  db: Db;
  timeline: TimelineStore;
  trips: TripRepo;
  merchant: MerchantClient;
  serv: ServClient;
  onDisruption: (info: DisruptionInfo) => Promise<void>;
  windowMs?: number;
}

const WINDOW_MS = 48 * 3600_000;
export const PACK_LABEL = {
  eu261: "EU261",
  uk261: "UK261",
  us_dot: "US DOT",
  in_dgca: "India DGCA",
} as const;
const sig = (s: FlightStatus) => `${s.state}|${s.depDelayMin}|${s.arrDelayMin}`;

/** Polls the flight feed for flights within 48 h; on cancellation or a ≥ 2 h delay it runs the rights pipeline once. */
export class DisruptionDetector {
  private seen = new Map<string, string>();
  private handled = new Set<string>();
  constructor(private d: DetectorDeps) {}

  latestAssessment(tripId: string): RightsAssessment | undefined {
    const row = this.d.db
      .query<{ json: string }, [string]>(
        "SELECT json FROM rights_assessments WHERE tripId = ? ORDER BY atUtc DESC, rowid DESC LIMIT 1",
      )
      .get(tripId);
    return row ? (JSON.parse(row.json) as RightsAssessment) : undefined;
  }

  async tick(tripId: string): Promise<void> {
    const trip = this.d.trips.get(tripId);
    if (!trip) return;
    const now = this.d.clock.now().getTime();
    for (const f of trip.flights) {
      const dep = Date.parse(f.schedDepUtc);
      if (dep - now > (this.d.windowMs ?? WINDOW_MS) || now - dep > 24 * 3600_000) continue;
      const status = await this.d.merchant.flightStatus(f.id).catch(() => undefined);
      if (!status) continue;
      const key = `${tripId}:${f.id}`;
      const s = sig(status);
      if (this.seen.get(key) === s) continue;
      const first = !this.seen.has(key);
      this.seen.set(key, s);
      if (!(first && status.state === "scheduled" && status.depDelayMin === 0)) {
        this.d.trips.update(tripId, (t) => ({
          ...t,
          flights: t.flights.map((x) => (x.id === f.id ? { ...x, status } : x)),
        }));
        this.d.timeline.append({
          tripId,
          type: "flight_status",
          title: `${f.carrier}${f.number} ${f.from}→${f.to}: ${status.state}${status.depDelayMin ? ` (+${status.depDelayMin} min)` : ""}`,
          data: { flightId: f.id, status },
        });
      }
      const disrupted =
        status.state === "cancelled" || status.depDelayMin >= 120 || status.arrDelayMin >= 120;
      if (!disrupted || this.handled.has(`${key}:${s}`)) continue;
      this.handled.add(`${key}:${s}`);
      await this.handle(tripId, { ...f, status }, status);
    }
  }

  private async handle(tripId: string, flight: Flight, status: FlightStatus) {
    const { timeline } = this.d;
    const notice = await this.d.merchant.flightNotice(flight.id).catch(() => "");
    const parsed = await parseNotice(this.d.serv, notice);
    if (parsed.error) {
      timeline.append({
        tripId,
        type: "error",
        title: "Couldn't read the airline's notice",
        detail: "Using the flight status feed only. Your rights are still assessed by the rules engine.",
      });
    }
    const facts = parsed.facts;
    const assessment = assess({ flight, status, facts, now: this.d.clock.now() });
    if (!assessment) return;
    const night = overnightNeeded(flight, status, facts);
    const id = crypto.randomUUID();
    this.d.db
      .query("INSERT INTO rights_assessments (id, tripId, flightId, json, atUtc) VALUES (?, ?, ?, ?, ?)")
      .run(id, tripId, flight.id, JSON.stringify(assessment), this.d.clock.now().toISOString());

    timeline.append({
      tripId,
      type: "disruption",
      title: `${flight.carrier}${flight.number} ${status.state === "cancelled" ? "cancelled" : `delayed ${status.depDelayMin} min`}`,
      detail: night.needed ? "You'll need somewhere to sleep tonight." : "No overnight stay needed.",
      data: { flightId: flight.id, facts, overnightNeeded: night.needed, nightDate: night.nightDate },
    });
    const explanation = await explainRights(this.d.serv, assessment);
    const packs = assessment.packs.map((p) => PACK_LABEL[p.pack]);
    timeline.append({
      tripId,
      type: "rights_assessed",
      title: `Your rights: ${packs.join(", ") || "none found"}`,
      detail: explanation.headline,
      data: { assessmentId: id, assessment, explanation },
    });
    await this.d.onDisruption({
      tripId,
      flight,
      status,
      facts,
      assessment,
      assessmentId: id,
      overnightNeeded: night.needed,
      nightDate: night.nightDate,
      origin: flight.from,
      voucherWarning: needsVoucherWarning(assessment, facts),
    });
  }
}
