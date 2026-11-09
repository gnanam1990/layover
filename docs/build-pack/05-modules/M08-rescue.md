# M08 — Rescue orchestrator (Act 2)
**Depends on:** M04, M05, M07, M10.

## Files
`services/core/src/rescue/{orchestrator.ts, options.ts}`

## Steps
1. If no overnight → rights + claim only; else hotels near origin airport, check-in = disruption date.
2. `options.ts` score = `rating*2 − distanceKm*0.3 − priceUSD*0.02`, refundable only, top 3; SERV OptionRank reasons.
3. Emit `voucher_warning` BEFORE any payment when flagged.
4. Top option → gate(`rescue_hotel`) → autoRescue & allow → pay → `payment` + `rescue_booked` (receipt); else "confirm hotel" prompt + `/rescue/confirm`.
5. None pass → `error` + proposed new session params. Then build ClaimPack (M09).

## Tests
`03-TEST-PLAN.md §M08`.

## DoD
CI green; live Act 2 hotel payment tx in PROVEN.md.

## Ship it (GitHub flow — required for every module)
1. Work on branch `mxx-<slug>` (created at module start from latest `main`).
2. Small commits while working (`feat(Mxx): …`, `test(Mxx): …`, `fix(Mxx): …`).
3. Before opening the PR run locally and paste results in the PR body: `pnpm lint`, `pnpm typecheck`, `pnpm test` (plus `LIVE=1` suites named in this module if they apply).
4. `gh pr create --base main --title "Mxx: <title>" --body-file .github/PR_BODY.md` using the PR template (what changed, tests added, verification evidence, tx links if any, DoD checklist ticked).
5. Wait for **CI green** (`gh pr checks --watch`). Self-review the diff (`gh pr diff`) against this module's DoD and `03-TEST-PLAN.md`; fix anything found.
6. Merge only when everything passes: `gh pr merge --squash --delete-branch`. Then `git checkout main && git pull`.
7. Update `docs/PROVEN.md` (if anything was proven live) in the same PR. Never push directly to `main`; never merge red CI; never skip hooks.
