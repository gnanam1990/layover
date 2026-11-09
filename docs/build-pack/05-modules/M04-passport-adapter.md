# M04 — Passport adapter & session manager
**Goal:** all Kite Passport interaction behind one interface; Fake for tests. **Depends on:** M00 (S1, S2, S7), M01.

## Files
`services/core/src/passport/{adapter.ts, kpass.ts, fake.ts, errors.ts, session-manager.ts}`

## Steps
1. Interface exactly as TDD §5. `kpass.ts` uses `Bun.spawn([KPASS_BIN, ...args, "--output", "json", "--no-interactive"])`, 60 s timeout, parses JSON; non-zero exit → `PassportError{code, hint}` (raw output redacted).
2. Commands come from **one argv table** set by spike S9 (`agent:session …` or `agent session …`): status, `wallet balance`/`wallet address`, session create (`--task-summary --max-amount-per-tx --max-total-amount --ttl --assets <pieUSD|USDC> --payment-approach x402_http` + the S2 constraint flag if available, scoped to `MERCHANT_PUBLIC_URL`), session status `--wait`, and execute `--url --method [--headers] [--body]`. `KPASS_SANDBOX=1` means `kpass sandbox on` was run (checked in `status()`).
2b. Implement the fallback payers from TDD §5.3 behind the same interface: `DirectX402Payer` (F2) and `StepUpSendPayer` (F3). Choose one with `PAYER=passport|direct|stepup` per the S8 result.
3. Amounts to kpass are USD decimal strings of the **settled** value (apply PRICE_SCALE).
4. `session-manager.ts`: `protectTrip(trip, settings)` → maxPerTx = maxPerBooking; maxTotal = emergencyBudget + maxPerBooking; ttl = checkout + 24 h; persist SessionRecord; background await → `session_active`; spentTotal from payments.
5. On any session error: never retry same session; emit UI prompt with proposed new params.

## Tests
`03-TEST-PLAN.md §M04`.

## DoD
Fake + argv + error tests green in CI; `@live` execute recorded in PROVEN.md.

## Ship it (GitHub flow — required for every module)
1. Work on branch `mxx-<slug>` (created at module start from latest `main`).
2. Small commits while working (`feat(Mxx): …`, `test(Mxx): …`, `fix(Mxx): …`).
3. Before opening the PR run locally and paste results in the PR body: `pnpm lint`, `pnpm typecheck`, `pnpm test` (plus `LIVE=1` suites named in this module if they apply).
4. `gh pr create --base main --title "Mxx: <title>" --body-file .github/PR_BODY.md` using the PR template (what changed, tests added, verification evidence, tx links if any, DoD checklist ticked).
5. Wait for **CI green** (`gh pr checks --watch`). Self-review the diff (`gh pr diff`) against this module's DoD and `03-TEST-PLAN.md`; fix anything found.
6. Merge only when everything passes: `gh pr merge --squash --delete-branch`. Then `git checkout main && git pull`.
7. Update `docs/PROVEN.md` (if anything was proven live) in the same PR. Never push directly to `main`; never merge red CI; never skip hooks.
