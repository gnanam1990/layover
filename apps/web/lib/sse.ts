"use client";
import { useEffect, useRef, useState } from "react";
import type { TimelineEvent } from "@layover/shared";

/**
 * Live trip timeline over SSE. EventSource reconnects by itself and sends Last-Event-ID,
 * which the proxy forwards so core resumes exactly after the last event we saw.
 */
export function useTimeline(tripId: string | undefined) {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const seen = useRef(new Set<string>());

  useEffect(() => {
    if (!tripId) return;
    seen.current = new Set();
    setEvents([]);
    const es = new EventSource(`/api/core/events?tripId=${encodeURIComponent(tripId)}`);
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.addEventListener("timeline", (m) => {
      const ev = JSON.parse((m as MessageEvent).data) as TimelineEvent;
      if (seen.current.has(ev.id)) return;
      seen.current.add(ev.id);
      setEvents((prev) => [...prev, ev]);
    });
    return () => es.close();
  }, [tripId]);

  return { events, connected };
}
