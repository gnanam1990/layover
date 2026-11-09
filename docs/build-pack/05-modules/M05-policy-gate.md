# M05 — Policy gate (pure)
**Goal:** the only place that can say "spend". **Depends on:** M01.

## File
`services/core/src/policy/gate.ts` — `export function gate(input: GateInput): PolicyDecision` — no I/O; `now` passed in.

## Rules
Exactly TDD §9. Each check pushes `{name, pass, detail}`; `allow = checks.every(c => c.pass)`; `reasons` = failing names. Stable names: `session_active, max_per_tx, max_total, currency, merchant_origin, amount_positive, consent, same_dates, room_class, hotel_quality, refundable, cancel_window, min_saving, overnight, distance, rating, date`.

## Tests
Full table `03-TEST-PLAN.md §M05` + property test (any single failing check ⇒ deny).

## DoD
100% branch coverage on gate.ts (coverage report in PR).

## Ship it (GitHub flow — required for every module)
1. Work on branch `mxx-<slug>` (created at module start from latest `main`).
2. Small commits while working (`feat(Mxx): …`, `test(Mxx): …`, `fix(Mxx): …`).
3. Before opening the PR run locally and paste results in the PR body: `pnpm lint`, `pnpm typecheck`, `pnpm test` (plus `LIVE=1` suites named in this module if they apply).
4. `gh pr create --base main --title "Mxx: <title>" --body-file .github/PR_BODY.md` using the PR template (what changed, tests added, verification evidence, tx links if any, DoD checklist ticked).
5. Wait for **CI green** (`gh pr checks --watch`). Self-review the diff (`gh pr diff`) against this module's DoD and `03-TEST-PLAN.md`; fix anything found.
6. Merge only when everything passes: `gh pr merge --squash --delete-branch`. Then `git checkout main && git pull`.
7. Update `docs/PROVEN.md` (if anything was proven live) in the same PR. Never push directly to `main`; never merge red CI; never skip hooks.
