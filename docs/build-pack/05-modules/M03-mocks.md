# M03 — Mock merchants, x402 proxies, flight feed, demo admin
**Goal:** a controllable world for both demo acts with **real Kite x402 payments**. **Depends on:** M00 (S1/S3/S7), M01.

## Files
`services/mocks/src/{hotel-upstream.ts, refund-sender.ts, paywall.ts, flight-feed.ts, demo-admin.ts, state.ts}`, `services/mocks/data/{hotels.json, flights.json}`.

## Seed data
- Near **GOI** (Act 1): Hotel Lumen Goa (4.2★, standard, $72 → drop to $58), Casa Mar (4.4★, 1.2 km, $80), Palm Row (3.9★, $64).
- Near **FRA** (Act 2): Airport Lodge FRA (4.0★, 6 km, $96), Main Riverside (4.3★, 13 km, $110), Terminal Inn (3.6★, 2 km, $64, non-refundable).
- Flights: LH761 FRA→BLR Dec 20 21:50 local (Act 2); 6E-512 BLR→GOI Dec 20 (Act 1 context); UA1782 SFO→JFK (tests).
- Rate tiers 58, 64, 72, 80, 96, 110 USD → **routes** `/v1/book/<tier>` in the **single deployed merchant**, priced `tier / PRICE_SCALE` (TDD §6.2).

## Steps
1. `state.ts`: in-memory state (prices, bookings, flights) + reset; persisted to `services/mocks/.state.json` (gitignored).
2. Hotel upstream (:8601) per TDD §6.1; booking validates tier == current tier else 409 `price_changed`; stores `{confirmation, refundTo, priceMinor}`; record which payer headers kite-x402-hono forwards (DECISIONS).
3. `paywall.ts` (replaces proxies.ts): `@x402/hono` `paymentMiddleware` with one route per tier (TDD §6.2), `payTo=MERCHANT_WALLET`, network from S1, Pieverse `/v2`. Settle only on upstream < 400. Tests use a simulated facilitator (as kite-x402-hono does via DI).
3b. **Deploy** the merchant (`/catalog/*`, `/v1/book/*`, `/admin/*` with `ADMIN_TOKEN`, `/healthz`, `/.well-known/x402`) to public HTTPS (Railway/Fly/Render), and set `MERCHANT_PUBLIC_URL`. CI does not deploy; deploy from `main` after merge (`railway up`).
4. `refund-sender.ts`: viem wallet (`MERCHANT_REFUND_KEY`) ERC20 `transfer(refundTo, atomic)`; idempotent per confirmation.
5. Flight feed (:8602) + notice text; demo admin (:8603) per TDD §6.5 (404 unless DEMO_MODE=1); admin calls notify core `/internal/simulated`.

## Tests
`03-TEST-PLAN.md §M03`.

## DoD
Tests green in CI; merchant live at `MERCHANT_PUBLIC_URL`; manual live (sandbox): `kpass agent session execute --url $MERCHANT_PUBLIC_URL/v1/book/72 --method POST --headers '{"Content-Type":"application/json"}' --body '{...}'` → confirmation + tx; cancel → refund tx on KiteScan; both in PROVEN.md.

## Ship it (GitHub flow — required for every module)
1. Work on branch `mxx-<slug>` (created at module start from latest `main`).
2. Small commits while working (`feat(Mxx): …`, `test(Mxx): …`, `fix(Mxx): …`).
3. Before opening the PR run locally and paste results in the PR body: `pnpm lint`, `pnpm typecheck`, `pnpm test` (plus `LIVE=1` suites named in this module if they apply).
4. `gh pr create --base main --title "Mxx: <title>" --body-file .github/PR_BODY.md` using the PR template (what changed, tests added, verification evidence, tx links if any, DoD checklist ticked).
5. Wait for **CI green** (`gh pr checks --watch`). Self-review the diff (`gh pr diff`) against this module's DoD and `03-TEST-PLAN.md`; fix anything found.
6. Merge only when everything passes: `gh pr merge --squash --delete-branch`. Then `git checkout main && git pull`.
7. Update `docs/PROVEN.md` (if anything was proven live) in the same PR. Never push directly to `main`; never merge red CI; never skip hooks.
