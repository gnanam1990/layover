import { describe, expect, test } from "bun:test";
import { createApp } from "../src/app";

describe("core /health", () => {
  test("returns ok", async () => {
    const app = createApp();
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; service: string };
    expect(body.ok).toBe(true);
    expect(body.service).toBe("layover-core");
  });
});
