import type { Clock } from "../src/clock";

export interface TestClock extends Clock {
  advance(ms: number): void;
  set(iso: string): void;
}

export function fixedClock(iso: string): TestClock {
  let t = Date.parse(iso);
  return {
    now: () => new Date(t),
    advance: (ms) => {
      t += ms;
    },
    set: (s) => {
      t = Date.parse(s);
    },
  };
}
