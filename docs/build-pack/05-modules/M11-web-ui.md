# M11 — Web app (Kite theme)
**Depends on:** core APIs.

## Steps
1. `styles/theme.css` tokens exactly as `04-UIUX-SPEC.md §1`; Tailwind v4 `@theme`; next/font DM Sans, JetBrains Mono, Spectral.
2. Components spec §2 + dev-only gallery `/dev/components`.
3. Screens S1–S7 with loading/empty/error states; microcopy verbatim (§4).
4. `lib/api.ts` typed fetchers; `lib/sse.ts` reconnecting EventSource with Last-Event-ID.
5. Rescue mode auto-opens on `disruption`; block order fixed (S4).
6. Accessibility §5; responsive 375/768/1280.

## Tests
`03-TEST-PLAN.md §M11` (Playwright + axe in CI with fakes).

## DoD
CI green; screenshots S1–S5 in `docs/screens/` committed in the PR.

## Ship it (GitHub flow — required for every module)
1. Work on branch `mxx-<slug>` (created at module start from latest `main`).
2. Small commits while working (`feat(Mxx): …`, `test(Mxx): …`, `fix(Mxx): …`).
3. Before opening the PR run locally and paste results in the PR body: `pnpm lint`, `pnpm typecheck`, `pnpm test` (plus `LIVE=1` suites named in this module if they apply).
4. `gh pr create --base main --title "Mxx: <title>" --body-file .github/PR_BODY.md` using the PR template (what changed, tests added, verification evidence, tx links if any, DoD checklist ticked).
5. Wait for **CI green** (`gh pr checks --watch`). Self-review the diff (`gh pr diff`) against this module's DoD and `03-TEST-PLAN.md`; fix anything found.
6. Merge only when everything passes: `gh pr merge --squash --delete-branch`. Then `git checkout main && git pull`.
7. Update `docs/PROVEN.md` (if anything was proven live) in the same PR. Never push directly to `main`; never merge red CI; never skip hooks.
