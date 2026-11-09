# Decisions and spike results

Deviations from `docs/build-pack/` and spike evidence, newest last.

## D1 — 2026-11-09 · Tooling versions
- Bun 1.3.14, pnpm 10.34.9, Node 22.23, TypeScript 5, Next.js 15, Tailwind 4, zod 4, Hono 4, viem 2, `@x402/hono` 2.30.
- zod 4 is used, so `z.toJSONSchema()` generates the strict JSON schemas sent to SERV (one source of truth instead of hand-written JSON schemas).

## Spikes
| ID | Status | Result / evidence |
|---|---|---|
| S1 | pending | needs kpass login (H2) |
| S2 | done | `execution_constraints.x402.allowed_endpoints` exists but is not enforced (D5) |
| S3 | done | dynamic price supported; settle only on < 400 (D4) |
| S4 | pending | needs ksearch |
| S5 | pending | needs SERV_API_KEY (H1) |
| S6 | done | official texts checked; corrections in D8 |
| S8 | pending | needs deployed merchant (H4) + kpass |
| S9 | done | kpass 6.13.1 syntax recorded in D5 |

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

## D4 — 2026-11-09 · M03 mock merchant and spike S3
- **S3 answered:** `@x402/hono` 2.30 supports a `DynamicPrice` callback, and its middleware cancels settlement when the handler returns status ≥ 400 (`if (res.status >= 400) … cancel`), so "charge only on success" holds. We still use **one route per rate tier** (`/v1/book/58|64|72|80|96|110`, plus `/v1/book/1` for the S8 spike) because the price is then explicit in `payUrl`, which the policy gate checks.
- Prices are declared as an explicit `AssetAmount` (`asset`, `amount` in atomic units, `extra: {name, version}` for EIP-712) because `eip155:2368/2366` are not in the library's default asset table.
- **One deployable app** (`services/mocks`) serves catalog, paywall, flight feed and demo admin on one port (default 8601) instead of separate :8601/:8602/:8603 processes. Same routes as TDD §6, fewer moving parts to deploy.
- `/catalog/hotels?near=` accepts an IATA code (distance from the airport, for Rescue) **or** a hotelId (distance from that hotel, for the Dropwatch "≤ 2 km" check).
- Extra seed hotel `Rhein Hostel` (3.4★, 8 km, $58) so ≥ 3 FRA offers are within 10 km (test plan §M03); it fails the 3.5★ rescue minimum, so Act 2 still picks Airport Lodge FRA ($96).
- Seeded booking `HX-2231` (made outside Kite) has no refund address; `/catalog/cancel` accepts `refundTo` only for such bookings.
- `FACILITATOR_URL=sim` runs the merchant offline with the simulated facilitator (dev only, never for the recorded demo).

## D5 — 2026-11-09 · Spike S9 (kpass CLI syntax) and M04 adapter
**S9 answered** with `kpass 6.13.1` (installed via the official Windows installer, `~/.kpass/bin`). The CLI differs from the pack:
| Pack assumed | kpass 6.13.1 |
|---|---|
| `agent:session create --max-amount-per-tx … --assets pieUSD --payment-approach x402_http` | `session create --delegation '<json>' --separate [--no-reuse --no-browser]`; delegation = `{task:{summary}, payment_policy:{max_amount_per_tx, max_total_amount, ttl_seconds, currency:"USD"}, execution_constraints?:{x402:{scope_mode:"scoped", allowed_endpoints:[{method,host,path_prefix}]}}}` |
| `--assets` allowlist | **removed**: sessions are token-agnostic, caps are USD, the session locks to the first settled asset |
| `agent:session status --wait` | `session status --request-id <req_…> --wait --timeout <s>` |
| `agent:session execute --url --method --headers --body` | `session execute --url --method --headers --body --idempotency-key <key> [--session-id]` (key is required; reuse it on retry, never change it) |
| tx in output | settlement reference at `payment.payment_response.reference`; merchant status at `x402.status_code`; body at `x402.parsed_response_body` |
| (none) | **account allowance**: `session execute` without an active session pays from the owner's allowance. Layover always uses an explicit `--separate` trip session so the passkey-approved caps are the trip's caps |
- Sandbox mode exists (`kpass sandbox on|off|status`, testnet + faucet money; login shared with live).
- `allowed_endpoints` is recorded but **not enforced** by Passport today, so Layover's own policy gate (merchant origin check) remains the enforcement point.
- All argv comes from one verb table (`passport/kpass.ts` `KPASS_ARGV`); a snapshot test proves a verb rename changes only the verbs.
- `FakePassport` pays the mock merchant through its real 402 flow (simulated facilitator) and enforces per-tx/total/TTL in 6-decimal fixed point.
- `DirectX402Payer` (F2) signs EIP-3009 `TransferWithAuthorization` per `accepts[0]` (domain `name`/`version` from `extra`, `verifyingContract` = token); verified with viem `verifyTypedData`.
- S2 (endpoint constraints): flag exists (`execution_constraints.x402`), recorded only — see above.

## D6 — 2026-11-09 · M06 Dropwatch
- A "price drop" is announced for the booked hotel at a lower price, or for a nearby alternative that already looks like a like-for-like swap (refundable, rating ≥ booked, ≤ 2 km, room class ≥ booked). The policy gate still re-checks everything; this pre-filter only keeps cheaper-but-worse hotels (e.g. Palm Row, 3.9★) from spamming the timeline.
- A denied drop is announced once per (hotel, price, reasons), not every tick.
- Rebook idempotency key: `tripId:bookingId:hotelId-roomClass-tier`, claimed in the `rebooks` table before paying; an in-process lock per booking stops two concurrent ticks.
- The fee is 30 % of the saving in integer cents (`pct(saving, 3000)`): saving $14.00 → fee $4.20, traveler keeps $9.80.
- Refund check: poll the chain every 5 s; after 2 min emit "Refund pending" and keep polling up to 30 min.

## D7 — 2026-11-09 · M07 rights engine and disruption detector
- The engine (`rights/engine.ts`) is pure and has **no free-text input**: it takes the flight, the feed status and SERV-parsed `NoticeFacts`. Amounts come only from rule-pack JSON; VERIFY amounts are emitted as `amountUpTo`.
- Only packs that apply are listed. `bestRemedy` ranks: HIGH compensation with an amount > any compensation > HIGH refund (no FX comparisons between currencies).
- Overnight rule: cancelled and no offered alternative before 06:00 local next day, or departure pushed to ≥ 23:00 local / the next day. `nightDate` = local date of the original departure at the origin (airport time zone).
- EU261 band C delays of 3–4 h are emitted as "up to €600, VERIFY" because Art. 7(2)(c) may halve them.
- US DOT meals/hotel appear only as "Airline commitment (DOT dashboard), check the airline" (MEDIUM), and only for controllable causes (technical, crew).
- If NoticeParse fails, the engine still runs on the feed status and the timeline gets an error event. If RightsExplain fails its number post-check twice, a deterministic explanation built from the assessment is shown (`source: "deterministic"`).

## D8 — 2026-11-09 · Spike S6: rule packs checked against official texts
Checked against EUR-Lex (Reg. 261/2004, CELEX:32004R0261; CJEU Sturgeon C-402/07), UK CAA guidance, eCFR 14 CFR 260 (2026-10-01) and DGCA CAR Section 3 Series M Part IV **Rev 4 (25 Jan 2023, effective 15 Feb 2023)**. Pack versions are now `2026-11-09-s6`.
| Rule | Before | After (official) |
|---|---|---|
| EU261 bands €250/€400/€600 | HIGH | **confirmed** |
| EU261 long-haul 3–4 h delay | "up to €600", VERIFY | **€300** (Art. 7(2)(c) applied to delays by Sturgeon para 63), HIGH |
| EU261 short-notice re-route exemption | VERIFY | told 7–14 days ahead: re-route ≤ 2 h early and < 4 h late; under 7 days: ≤ 1 h early and < 2 h late. Implemented assuming the same block time |
| UK261 £220/£350/£520 | VERIFY | **confirmed** (CAA), plus **£260** for 3–4 h long-haul |
| US significant change | max(dep, arr) delay | departing ≥ 3/6 h **earlier** or arriving ≥ 3/6 h **later**; Layover only sees delays, so it uses the arrival delay |
| US refund timing | MEDIUM | confirmed: 7 business days (card) / 20 calendar days (other) |
| DGCA cancellation compensation | notice < 14 days | notice **< 24 h** only; 24 h–2 weeks → alternate or refund only. Amounts ₹5k/₹7.5k/₹10k confirmed, still shown as "up to" (capped at fare + fuel charge) |
| DGCA meals | flat 2 h | 2 h (block ≤ 2.5 h), 3 h (2.5–5 h), 4 h (> 5 h) |
| DGCA alternate/refund for delays | 6 h | > 6 h, **domestic only** |
| DGCA hotel | 24 h or overnight | > 24 h, or > 6 h for departures between 20:00 and 03:00 |
Not modelled (out of demo scope): DGCA denied boarding (para 3.2) and downgrades (3.5.1).

## D9 — 2026-11-09 · Core API, demo clock, offline mode
- `services.ts` wires every core service from config; `createApp` exposes TDD §7 routes plus DEMO_MODE-only `/demo/*` (seed, price, flight, reset, tick, time, approve, state). Every non-GET route needs `x-layover-token`; the web app's server-side proxy adds it, so the browser never holds it.
- Trip intake: SERV extracts identifiers only (flight number + date, hotel confirmation); schedules, prices and refundability are looked up at the source (flight feed, merchant). Missing facts come back as one list of questions.
- **Demo clock** (`DEMO_NOW`, `OffsetClock`): the trip is in December, so the recording runs with the clock shifted to the trip day (time still flows). `/health` reports `demoClock: true`.
- **Offline mode** for tests/dev: `PAYER=fake` (FakePassport) + `FACILITATOR_URL=sim` on the merchant + no `SERV_API_KEY` → a deterministic SERV stub. `/health` reports `serv: "offline-stub"` and `payer: "fake"`; never used for the recorded demo.
- Ticks (background loops and demo buttons) run on one serialized chain, so a demo button and a poll never interleave.
- Fixes found by running real processes: the merchant now rolls a cancellation back if its refund can't be sent; Dropwatch no longer re-announces a drop it already acted on.
