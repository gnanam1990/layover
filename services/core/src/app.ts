import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { openDb, type Db } from "./db";
import { systemClock, type Clock } from "./clock";
import { TimelineStore } from "./timeline/store";
import type { TimelineEvent } from "@layover/shared";

export interface AppDeps {
  db: Db;
  clock: Clock;
  timeline: TimelineStore;
  /** Shared secret for /internal/* and mutating routes (LAYOVER_LOCAL_TOKEN). */
  localToken: string;
}

export function defaultDeps(over: Partial<AppDeps> = {}): AppDeps {
  const db = over.db ?? openDb(":memory:");
  const clock = over.clock ?? systemClock;
  return {
    db,
    clock,
    timeline: over.timeline ?? new TimelineStore(db, clock),
    localToken: over.localToken ?? process.env.LAYOVER_LOCAL_TOKEN ?? "change-me",
  };
}

const SimulatedBody = z.object({
  tripId: z.string().default("*"),
  ms: z.number().int().positive().optional(),
});

export function createApp(over: Partial<AppDeps> = {}) {
  const deps = defaultDeps(over);
  const app = new Hono();

  app.get("/health", (c) => c.json({ ok: true, service: "layover-core" }));

  app.use("/internal/*", async (c, next) => {
    if (c.req.header("x-layover-token") !== deps.localToken) return c.json({ error: "unauthorized" }, 401);
    await next();
  });

  app.post("/internal/simulated", async (c) => {
    const body = SimulatedBody.parse(await c.req.json().catch(() => ({})));
    deps.timeline.markSimulated(body.tripId, body.ms);
    return c.json({ ok: true });
  });

  app.get("/trips/:id/timeline", (c) => c.json(deps.timeline.list(c.req.param("id"))));

  app.get("/events", (c) => {
    const tripId = c.req.query("tripId") ?? "*";
    const lastId = c.req.header("Last-Event-ID") ?? c.req.query("lastEventId");
    return streamSSE(c, async (stream) => {
      const queue: TimelineEvent[] = [];
      let wake: (() => void) | null = null;
      const unsub = deps.timeline.subscribe(tripId, (ev) => {
        queue.push(ev);
        wake?.();
      });
      let closed = false;
      stream.onAbort(() => {
        closed = true;
        unsub();
        wake?.();
      });
      // Replay history first (subscribe happened before, so nothing is lost in between).
      const history = tripId === "*" ? [] : deps.timeline.list(tripId, lastId);
      let lastSent = Number(lastId ?? 0);
      for (const ev of history) {
        await stream.writeSSE({ id: ev.id, event: "timeline", data: JSON.stringify(ev) });
        lastSent = Number(ev.id);
      }
      while (!closed) {
        while (queue.length) {
          const ev = queue.shift()!;
          if (Number(ev.id) <= lastSent) continue;
          await stream.writeSSE({ id: ev.id, event: "timeline", data: JSON.stringify(ev) });
          lastSent = Number(ev.id);
        }
        await new Promise<void>((r) => {
          wake = r;
          setTimeout(r, 15_000);
        });
        wake = null;
        if (!queue.length && !closed) await stream.writeSSE({ event: "ping", data: "{}" });
      }
    });
  });

  return app;
}
