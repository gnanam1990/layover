# M06 — Dropwatch (price-drop rebook, Act 1)
**Depends on:** M02, M03, M04, M05, M10.

## Files
`services/core/src/dropwatch/{watcher.ts, rebook.ts}`

## Steps
1. Watcher interval `DROPWATCH_INTERVAL_MS` (demo 15000) over active refundable bookings with future cancel deadline: `catalog/quote` + `catalog/hotels?near`; emit `price_checked` (throttled 1/min).
2. Best candidate → `gate({action:"rebook"})` → `policy_decision` event (all checks); deny → stop.
3. `rebook.ts` persisted state machine `PAYING → BOOKED → CANCELLING → REFUND_PENDING → DONE | FAILED_*`, idempotency key `tripId:bookingId:offerId`:
   - PAYING: `passport.execute(POST payUrl, {…, refundTo: wallet})` → store payment → `payment` + `booking_confirmed`.
   - CANCELLING (only after BOOKED): `POST /catalog/cancel` → `cancel_requested` with refundTx.
   - REFUND_PENDING: `verifyRefund` poll 5 s ≤ 2 min → `refund_verified` ("Saved $X · fee 30%") else `error` "Refund pending", keep polling 30 min.

## Tests
`03-TEST-PLAN.md §M06`.

## DoD
CI green; live Act 1 run → payment tx + refund tx in PROVEN.md (same PR).

## Ship it (GitHub flow — required for every module)
1. Work on branch `mxx-<slug>` (created at module start from latest `main`).
2. Small commits while working (`feat(Mxx): …`, `test(Mxx): …`, `fix(Mxx): …`).
3. Before opening the PR run locally and paste results in the PR body: `pnpm lint`, `pnpm typecheck`, `pnpm test` (plus `LIVE=1` suites named in this module if they apply).
4. `gh pr create --base main --title "Mxx: <title>" --body-file .github/PR_BODY.md` using the PR template (what changed, tests added, verification evidence, tx links if any, DoD checklist ticked).
5. Wait for **CI green** (`gh pr checks --watch`). Self-review the diff (`gh pr diff`) against this module's DoD and `03-TEST-PLAN.md`; fix anything found.
6. Merge only when everything passes: `gh pr merge --squash --delete-branch`. Then `git checkout main && git pull`.
7. Update `docs/PROVEN.md` (if anything was proven live) in the same PR. Never push directly to `main`; never merge red CI; never skip hooks.
