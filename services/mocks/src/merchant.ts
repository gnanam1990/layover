import { Hono } from "hono";

export function createMerchantApp() {
  const app = new Hono();
  app.get("/healthz", (c) => c.json({ ok: true, service: "layover-merchant" }));
  return app;
}
