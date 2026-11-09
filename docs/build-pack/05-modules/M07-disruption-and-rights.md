# M07 — Disruption detector & passenger-rights engine
**Depends on:** M01, M02, M03.

## Files
`services/core/src/disruption/{detector.ts, notice.ts}`, `services/core/src/rights/{engine.ts, distance.ts}`

## Steps
1. Detector polls flight feed every `FLIGHT_POLL_MS` (demo 5000) for flights within 48 h; on cancelled or delay ≥ 120 min → notice → SERV NoticeParse → engine.assess → persist → `disruption` + `rights_assessed` → SERV RightsExplain (post-checked) → Rescue handoff.
2. `engine.ts` exactly TDD §10 + rule packs; pure; `now` injected. `distance.ts` haversine.
3. Overnight needed if (cancelled AND no offered alternative departs before 06:00 next day local) OR (departure pushed past 23:00 local) — constants.
4. `voucher_warning` if `us_dot` applies to cancellation/significant change OR `offeredVoucher`.

## Tests
`03-TEST-PLAN.md §M07` (E1–E5, U1–U2, I1–I2, M1, X1, injection notice, explain post-check).

## DoD
CI green; S6 confirmations reflected in rule packs.

## Ship it (GitHub flow — required for every module)
1. Work on branch `mxx-<slug>` (created at module start from latest `main`).
2. Small commits while working (`feat(Mxx): …`, `test(Mxx): …`, `fix(Mxx): …`).
3. Before opening the PR run locally and paste results in the PR body: `pnpm lint`, `pnpm typecheck`, `pnpm test` (plus `LIVE=1` suites named in this module if they apply).
4. `gh pr create --base main --title "Mxx: <title>" --body-file .github/PR_BODY.md` using the PR template (what changed, tests added, verification evidence, tx links if any, DoD checklist ticked).
5. Wait for **CI green** (`gh pr checks --watch`). Self-review the diff (`gh pr diff`) against this module's DoD and `03-TEST-PLAN.md`; fix anything found.
6. Merge only when everything passes: `gh pr merge --squash --delete-branch`. Then `git checkout main && git pull`.
7. Update `docs/PROVEN.md` (if anything was proven live) in the same PR. Never push directly to `main`; never merge red CI; never skip hooks.
