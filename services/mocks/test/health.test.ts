import { describe, expect, test } from "bun:test";
import { createMerchantApp } from "../src/merchant";

describe("merchant /healthz", () => {
  test("returns ok", async () => {
    const app = createMerchantApp();
    const res = await app.request("/healthz");
    expect(res.status).toBe(200);
    expect(((await res.json()) as { ok: boolean }).ok).toBe(true);
  });
});
