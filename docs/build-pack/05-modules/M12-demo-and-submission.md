# M12 — Demo runner, README, release, submission
**Depends on:** all.

## Steps
1. `demo:act1` (reset → drop Lumen to $58 → wait `refund_verified`) and `demo:act2` (reset → cancel LH761 with voucher-offer notice → wait `rescue_booked` + `claim_ready`); print tx links.
2. Root README: hero screenshot, 30-second pitch, SERV call-graph table (TDD §11), Kite Passport usage, **What is proven** (PROVEN.md tx links), **What is mocked**, trust assumptions, run steps, revenue model, credits (kite-x402-hono, OpenServ, Kite).
3. Final acceptance `03-TEST-PLAN.md §M12` on `main` after merge; then `gh release create v1.0.0 --title "Layover v1.0 — SERV Hackathon 02" --notes-file docs/RELEASE.md`.
4. **[HUMAN]** record video (storyboard), post X thread, submit typeform (checklist). Commit submission screenshot to `docs/`.

## DoD
Release v1.0.0 on the public repo; submission confirmed.

## Ship it (GitHub flow — required for every module)
1. Work on branch `mxx-<slug>` (created at module start from latest `main`).
2. Small commits while working (`feat(Mxx): …`, `test(Mxx): …`, `fix(Mxx): …`).
3. Before opening the PR run locally and paste results in the PR body: `pnpm lint`, `pnpm typecheck`, `pnpm test` (plus `LIVE=1` suites named in this module if they apply).
4. `gh pr create --base main --title "Mxx: <title>" --body-file .github/PR_BODY.md` using the PR template (what changed, tests added, verification evidence, tx links if any, DoD checklist ticked).
5. Wait for **CI green** (`gh pr checks --watch`). Self-review the diff (`gh pr diff`) against this module's DoD and `03-TEST-PLAN.md`; fix anything found.
6. Merge only when everything passes: `gh pr merge --squash --delete-branch`. Then `git checkout main && git pull`.
7. Update `docs/PROVEN.md` (if anything was proven live) in the same PR. Never push directly to `main`; never merge red CI; never skip hooks.
