import { Trip } from "@layover/shared";
import type { Db } from "../db";
import type { Clock } from "../clock";

export class TripRepo {
  constructor(
    private db: Db,
    private clock: Clock,
  ) {}

  save(trip: Trip): Trip {
    const t = Trip.parse(trip);
    this.db
      .query(
        "INSERT INTO trips (id, json, updatedAt) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json, updatedAt = excluded.updatedAt",
      )
      .run(t.id, JSON.stringify(t), this.clock.now().toISOString());
    return t;
  }

  get(id: string): Trip | undefined {
    const row = this.db.query<{ json: string }, [string]>("SELECT json FROM trips WHERE id = ?").get(id);
    return row ? Trip.parse(JSON.parse(row.json)) : undefined;
  }

  list(): Trip[] {
    return this.db
      .query<{ json: string }, []>("SELECT json FROM trips ORDER BY updatedAt DESC")
      .all()
      .map((r) => Trip.parse(JSON.parse(r.json)));
  }

  update(id: string, fn: (t: Trip) => Trip): Trip {
    const t = this.get(id);
    if (!t) throw new Error(`trip ${id} not found`);
    return this.save(fn(structuredClone(t)));
  }
}
