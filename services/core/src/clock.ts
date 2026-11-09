export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

/**
 * Demo clock: real time shifted by an offset, so the December trip can be "today" while recording.
 * Time still flows (TTL, polling and timeline order behave normally).
 */
export class OffsetClock implements Clock {
  private offsetMs = 0;
  constructor(startIso?: string) {
    if (startIso) this.set(startIso);
  }
  now() {
    return new Date(Date.now() + this.offsetMs);
  }
  set(iso: string) {
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) throw new RangeError(`bad time ${iso}`);
    this.offsetMs = t - Date.now();
  }
  get shifted() {
    return Math.abs(this.offsetMs) > 60_000;
  }
}
