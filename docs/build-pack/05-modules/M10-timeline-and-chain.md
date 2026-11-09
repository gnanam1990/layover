# M10 — Timeline, SSE, chain verifier (build early)
**Depends on:** M01.

## Files
`services/core/src/timeline/{store.ts, events.ts}`, `services/core/src/chain/verify.ts`, routes in `index.ts`.

## Steps
1. `store.append` (SQLite) + emitter; `GET /trips/:id/timeline`; `GET /events?tripId` SSE with `id:`; honor `Last-Event-ID`.
2. `/internal/simulated` marks related events `simulated:true` for 30 s.
3. `verify.ts` (viem): `waitReceipt`, `verifyRefund({tx, token, from, to, amountAtomic})` via ERC20 Transfer logs; `explorerTx(hash)` per network.

## Tests
`03-TEST-PLAN.md §M10`.

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
