# Decisions and spike results

Deviations from `docs/build-pack/` and spike evidence, newest last.

## D1 — 2026-11-09 · Tooling versions
- Bun 1.3.14, pnpm 10.34.9, Node 22.23, TypeScript 5, Next.js 15, Tailwind 4, zod 4, Hono 4, viem 2, `@x402/hono` 2.30.
- zod 4 is used, so `z.toJSONSchema()` generates the strict JSON schemas sent to SERV (one source of truth instead of hand-written JSON schemas).

## Spikes
| ID | Status | Result / evidence |
|---|---|---|
| S1 | pending | needs kpass login (H2) |
| S2 | pending | needs kpass installed |
| S3 | pending | |
| S4 | pending | needs ksearch |
| S5 | pending | needs SERV_API_KEY (H1) |
| S6 | pending | |
| S8 | pending | needs deployed merchant (H4) + kpass |
| S9 | pending | needs kpass installed |
