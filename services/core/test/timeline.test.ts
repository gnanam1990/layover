import { describe, expect, test } from "bun:test";
import { openDb } from "../src/db";
import { TimelineStore } from "../src/timeline/store";
import { createApp } from "../src/app";
import { fixedClock } from "./helpers";

function setup(startIso = "2026-12-20T20:00:00Z") {
  const db = openDb(":memory:");
  const clock = fixedClock(startIso);
  const timeline = new TimelineStore(db, clock);
  const app = createApp({ db, timeline, clock, localToken: "t0k" });
  return { db, clock, timeline, app };
}

async function readSse(res: Response, wantEvents: number, timeoutMs = 2000) {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  const events: { id: string; data: string; event: string }[] = [];
  const deadline = Date.now() + timeoutMs;
  while (events.length < wantEvents && Date.now() < deadline) {
    const { value, done } = await Promise.race([
      reader.read(),
      new Promise<{ value: undefined; done: true }>((r) =>
        setTimeout(() => r({ value: undefined, done: true }), 200),
      ),
    ]);
    if (value) buf += dec.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const block = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const ev = { id: "", data: "", event: "message" };
      for (const line of block.split("\n")) {
        if (line.startsWith("id:")) ev.id = line.slice(3).trim();
        else if (line.startsWith("data:")) ev.data += line.slice(5).trim();
        else if (line.startsWith("event:")) ev.event = line.slice(6).trim();
      }
      if (ev.data) events.push(ev);
    }
    if (done && !value) continue;
  }
  await reader.cancel();
  return events;
}

describe("TimelineStore", () => {
  test("append persists events in order with increasing ids", () => {
    const { timeline } = setup();
    const a = timeline.append({ tripId: "t1", type: "trip_added", title: "Trip added" });
    const b = timeline.append({ tripId: "t1", type: "price_checked", title: "Checked" });
    timeline.append({ tripId: "t2", type: "trip_added", title: "Other trip" });
    expect(Number(b.id)).toBeGreaterThan(Number(a.id));
    const list = timeline.list("t1");
    expect(list.map((e) => e.type)).toEqual(["trip_added", "price_checked"]);
    expect(list[0]!.simulated).toBe(false);
    expect(list[0]!.atUtc).toBe("2026-12-20T20:00:00.000Z");
  });

  test("list(after) returns only newer events", () => {
    const { timeline } = setup();
    const a = timeline.append({ tripId: "t1", type: "trip_added", title: "1" });
    timeline.append({
      tripId: "t1",
      type: "payment",
      title: "2",
      links: [{ label: "tx", url: "https://x" }],
    });
    const after = timeline.list("t1", a.id);
    expect(after).toHaveLength(1);
    expect(after[0]!.links).toEqual([{ label: "tx", url: "https://x" }]);
  });

  test("markSimulated flags events for 30 s, then stops", () => {
    const { timeline, clock } = setup();
    timeline.markSimulated("t1");
    expect(timeline.append({ tripId: "t1", type: "price_drop", title: "drop" }).simulated).toBe(true);
    expect(timeline.append({ tripId: "t9", type: "price_drop", title: "other trip" }).simulated).toBe(false);
    clock.advance(31_000);
    expect(timeline.append({ tripId: "t1", type: "price_checked", title: "later" }).simulated).toBe(false);
    timeline.markSimulated("*");
    expect(timeline.append({ tripId: "t9", type: "flight_status", title: "any" }).simulated).toBe(true);
  });

  test("rejects unknown event types", () => {
    const { timeline } = setup();
    // @ts-expect-error invalid type on purpose
    expect(() => timeline.append({ tripId: "t1", type: "party", title: "x" })).toThrow();
  });
});

describe("routes", () => {
  test("GET /trips/:id/timeline returns events", async () => {
    const { app, timeline } = setup();
    timeline.append({ tripId: "t1", type: "trip_added", title: "Trip added" });
    const res = await app.request("/trips/t1/timeline");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { type: string }[];
    expect(body.map((e) => e.type)).toEqual(["trip_added"]);
  });

  test("POST /internal/simulated requires the local token", async () => {
    const { app, timeline } = setup();
    const bad = await app.request("/internal/simulated", {
      method: "POST",
      body: JSON.stringify({ tripId: "t1" }),
    });
    expect(bad.status).toBe(401);
    const ok = await app.request("/internal/simulated", {
      method: "POST",
      headers: { "x-layover-token": "t0k", "content-type": "application/json" },
      body: JSON.stringify({ tripId: "t1" }),
    });
    expect(ok.status).toBe(200);
    expect(timeline.append({ tripId: "t1", type: "price_drop", title: "d" }).simulated).toBe(true);
  });

  test("SSE replays history, streams live events in order, and resumes with Last-Event-ID", async () => {
    const { app, timeline } = setup();
    const e1 = timeline.append({ tripId: "t1", type: "trip_added", title: "1" });
    timeline.append({ tripId: "t1", type: "session_requested", title: "2" });

    const res = await app.request("/events?tripId=t1");
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    setTimeout(() => timeline.append({ tripId: "t1", type: "session_active", title: "3" }), 50);
    setTimeout(() => timeline.append({ tripId: "t2", type: "trip_added", title: "other" }), 60);
    const got = await readSse(res, 3);
    expect(got.map((e) => JSON.parse(e.data).title)).toEqual(["1", "2", "3"]);
    expect(got.every((e) => e.event === "timeline")).toBe(true);

    const res2 = await app.request("/events?tripId=t1", { headers: { "Last-Event-ID": e1.id } });
    const resumed = await readSse(res2, 2);
    expect(resumed.map((e) => JSON.parse(e.data).title)).toEqual(["2", "3"]);
  });
});
