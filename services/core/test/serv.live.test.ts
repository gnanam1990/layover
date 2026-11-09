import { describe, expect, test } from "bun:test";
import { createServClient } from "../src/serv/client";
import { tripIntake } from "../src/serv/prompts/tripIntake";

const LIVE = process.env.LIVE === "1" && !!process.env.SERV_API_KEY;

describe.skipIf(!LIVE)("@live SERV", () => {
  test(
    "TripIntake parses a typed trip into a valid TripDraft",
    async () => {
      const serv = createServClient({ apiKey: process.env.SERV_API_KEY! });
      const t0 = Date.now();
      const draft = await tripIntake(serv, "LH761 FRA→BLR Dec 20, hotel HX-2231 Hotel Lumen Goa Dec 20–22");
      console.log(`TripIntake latency ${Date.now() - t0} ms`, JSON.stringify(draft));
      expect(draft.flights[0]?.from).toBe("FRA");
      expect(draft.flights[0]?.to).toBe("BLR");
      expect(draft.hotels[0]?.confirmation).toBe("HX-2231");
    },
    { timeout: 90_000 },
  );
});
