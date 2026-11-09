import { describe, expect, test } from "bun:test";
import { KpassPassport } from "../src/passport/kpass";

// @live S1/S8 (sandbox): needs `kpass` logged in, `kpass sandbox on`, an approved session, and a public merchant.
const LIVE = process.env.LIVE === "1" && !!process.env.MERCHANT_PUBLIC_URL;

describe.skipIf(!LIVE)("@live Kite Passport", () => {
  test(
    "execute against the spike tier returns 200 and a settlement tx",
    async () => {
      const kp = new KpassPassport();
      const r = await kp.execute({
        url: `${process.env.MERCHANT_PUBLIC_URL}/v1/book/1`,
        method: "POST",
        body: { spike: true },
        idempotencyKey: `spike-${Date.now()}`,
      });
      console.log("S8 result", JSON.stringify(r));
      expect(r.status).toBe(200);
      expect(r.payment?.tx).toMatch(/^0x[0-9a-fA-F]{64}$/);
    },
    { timeout: 330_000 },
  );
});
