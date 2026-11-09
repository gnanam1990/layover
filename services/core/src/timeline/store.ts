import { TimelineEvent, type TimelineEventType } from "@layover/shared";
import type { Db } from "../db";
import type { Clock } from "../clock";

export interface AppendInput {
  tripId: string;
  type: TimelineEventType;
  title: string;
  detail?: string;
  data?: Record<string, unknown>;
  links?: { label: string; url: string }[];
  simulated?: boolean;
}

type Listener = (ev: TimelineEvent) => void;

interface Row {
  seq: number;
  tripId: string;
  atUtc: string;
  type: string;
  simulated: number;
  title: string;
  detail: string | null;
  data: string | null;
  links: string | null;
}

export const SIMULATED_WINDOW_MS = 30_000;

/** Append-only trip timeline. Event ids are the SQLite sequence, so they double as SSE ids. */
export class TimelineStore {
  private listeners = new Set<{ tripId: string; fn: Listener }>();
  private simulatedUntil = new Map<string, number>();

  constructor(
    private db: Db,
    private clock: Clock,
  ) {}

  /** Events for `tripId` (or "*" for every trip) appended in the next 30 s are flagged simulated. */
  markSimulated(tripId: string, ms = SIMULATED_WINDOW_MS) {
    this.simulatedUntil.set(tripId, this.clock.now().getTime() + ms);
  }

  private isSimulated(tripId: string): boolean {
    const now = this.clock.now().getTime();
    return (this.simulatedUntil.get(tripId) ?? 0) > now || (this.simulatedUntil.get("*") ?? 0) > now;
  }

  append(input: AppendInput): TimelineEvent {
    const atUtc = this.clock.now().toISOString();
    const simulated = input.simulated ?? this.isSimulated(input.tripId);
    // Validate before writing so a bad event never lands in the store.
    TimelineEvent.parse({ ...input, id: "0", atUtc, simulated });
    const row = this.db
      .query<
        { seq: number },
        [string, string, string, number, string, string | null, string | null, string | null]
      >(
        `INSERT INTO events (tripId, atUtc, type, simulated, title, detail, data, links)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING seq`,
      )
      .get(
        input.tripId,
        atUtc,
        input.type,
        simulated ? 1 : 0,
        input.title,
        input.detail ?? null,
        input.data ? JSON.stringify(input.data) : null,
        input.links ? JSON.stringify(input.links) : null,
      )!;
    const ev: TimelineEvent = {
      id: String(row.seq),
      tripId: input.tripId,
      atUtc,
      type: input.type,
      simulated,
      title: input.title,
      ...(input.detail !== undefined && { detail: input.detail }),
      ...(input.data !== undefined && { data: input.data }),
      ...(input.links !== undefined && { links: input.links }),
    };
    for (const l of this.listeners) if (l.tripId === ev.tripId || l.tripId === "*") l.fn(ev);
    return ev;
  }

  list(tripId: string, afterId?: string): TimelineEvent[] {
    const after = afterId && /^\d+$/.test(afterId) ? Number(afterId) : 0;
    const rows = this.db
      .query<Row, [string, number]>("SELECT * FROM events WHERE tripId = ? AND seq > ? ORDER BY seq")
      .all(tripId, after);
    return rows.map(fromRow);
  }

  subscribe(tripId: string, fn: Listener): () => void {
    const entry = { tripId, fn };
    this.listeners.add(entry);
    return () => this.listeners.delete(entry);
  }
}

function fromRow(r: Row): TimelineEvent {
  return {
    id: String(r.seq),
    tripId: r.tripId,
    atUtc: r.atUtc,
    type: r.type as TimelineEventType,
    simulated: r.simulated === 1,
    title: r.title,
    ...(r.detail !== null && { detail: r.detail }),
    ...(r.data !== null && { data: JSON.parse(r.data) as Record<string, unknown> }),
    ...(r.links !== null && { links: JSON.parse(r.links) as { label: string; url: string }[] }),
  };
}
