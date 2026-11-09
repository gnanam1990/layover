# M09 — Claim pack
**Depends on:** M02, M07, M10.

## File
`services/core/src/claims/pack.ts`

## Steps
1. `ClaimData` = trip/flight/booking refs + RightsAssessment entitlements (copied, never recomputed) + disruption timeline + receipts (desc, amount, tx, explorer URL).
2. SERV ClaimDraft → `{subject, body}`; post-check every amount/ref/tx ∈ ClaimData and VERIFY amounts say "up to"; fail → retry once → else `validated:false` + deterministic template letter.
3. Persist; `claim_ready`; `mailto:` (≤2000 chars else copy-only).

## Tests
`03-TEST-PLAN.md §M09`.

## DoD
CI green.

## Ship it (GitHub flow — required for every module)
1. Work on branch `mxx-<slug>` (created at module start from latest `main`).
2. Small commits while working (`feat(Mxx): …`, `test(Mxx): …`, `fix(Mxx): …`).
3. Before opening the PR run locally and paste results in the PR body: `pnpm lint`, `pnpm typecheck`, `pnpm test` (plus `LIVE=1` suites named in this module if they apply).
4. `gh pr create --base main --title "Mxx: <title>" --body-file .github/PR_BODY.md` using the PR template (what changed, tests added, verification evidence, tx links if any, DoD checklist ticked).
5. Wait for **CI green** (`gh pr checks --watch`). Self-review the diff (`gh pr diff`) against this module's DoD and `03-TEST-PLAN.md`; fix anything found.
6. Merge only when everything passes: `gh pr merge --squash --delete-branch`. Then `git checkout main && git pull`.
7. Update `docs/PROVEN.md` (if anything was proven live) in the same PR. Never push directly to `main`; never merge red CI; never skip hooks.
