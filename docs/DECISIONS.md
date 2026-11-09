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

## D2 — 2026-11-09 · M01 shared package layout
- `airports.json` lives in `packages/shared/data/` (not `services/mocks/data/`) because the rights engine in core needs it too; mocks import it from `@layover/shared`.
- Each zod schema and its inferred type share one name (e.g. `Trip` is both), exported from `schemas.ts`; there is no separate `types.ts`.
- Rule packs are validated with the zod mirror of `rule-pack.schema.json` at import time (fail fast) and in tests.
- Rule-pack confidence levels copy `00-context/03-passenger-rights-rules.md`; S6 (official-text check) will upgrade VERIFY rows.

## D3 — 2026-11-09 · M02 SERV client
- The strict JSON schema sent to SERV is generated from the zod schema with `z.toJSONSchema(..., { target: "draft-7" })` (all fields required, nullable as `["string","null"]`, `additionalProperties: false`).
- Retry policy lives in our client (OpenAI SDK `maxRetries: 0`): 429 → 1 s/2 s/4 s then `ServRateLimitError`; 5xx/network → one retry then `ServUpstreamError`; schema/post-check failure → one retry carrying the errors, then `ServValidationError`.
- `ClaimDraft` falls back from `claude-sonnet-5.5` to `gpt-5.4-mini` only when SERV answers 400/404 for the model.
- RightsExplain post-check: every number in the explanation must appear in the assessment JSON (raw, or an `amountMinor` in major units).
- S5 (live SERV call) is still pending: it needs `SERV_API_KEY` (H1). The `@live` suite is `LIVE=1 bun test test/serv.live.test.ts`.
