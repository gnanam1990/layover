# M01 — Shared schemas, money, rule packs
**Goal:** single source of truth for types and data. **Depends on:** M00.

## Files
`packages/shared/src/{schemas.ts, types.ts, money.ts, index.ts}`, `packages/shared/rules/{eu261,uk261,us_dot,in_dgca}.json`, `packages/shared/rules/rule-pack.schema.json`, `services/mocks/data/airports.json`.

## Steps
1. Port every schema in `08-reference/schemas/*.json` to zod (identical names); export inferred types.
2. `money.ts`: `toMinor(str, currency)`, `fromMinor`, `toAtomic(minor, decimals, priceScale)`, `fromAtomic`, `add/sub/cmp`, `pct(minor, bps)`; bigint only; throw on float input.
3. Rule packs: encode `00-context/03-passenger-rights-rules.md` as JSON validated by `rule-pack.schema.json` (`08-reference/schemas/rule-pack.schema.json`). Use S6 results for confidence.
4. `airports.json`: IATA → {lat, lon, country, region:"EU|EEA|UK|US|IN|OTHER", tz} for at least FRA, MUC, CDG, AMS, LHR, MAD, BLR, DEL, BOM, GOI, MAA, JFK, SFO, ORD, DXB, SIN.

## Tests
`03-TEST-PLAN.md §M01`.

## DoD
Schema + money tests green; rule packs validate in CI.

## Ship it (GitHub flow — required for every module)
1. Work on branch `mxx-<slug>` (created at module start from latest `main`).
2. Small commits while working (`feat(Mxx): …`, `test(Mxx): …`, `fix(Mxx): …`).
3. Before opening the PR run locally and paste results in the PR body: `pnpm lint`, `pnpm typecheck`, `pnpm test` (plus `LIVE=1` suites named in this module if they apply).
4. `gh pr create --base main --title "Mxx: <title>" --body-file .github/PR_BODY.md` using the PR template (what changed, tests added, verification evidence, tx links if any, DoD checklist ticked).
5. Wait for **CI green** (`gh pr checks --watch`). Self-review the diff (`gh pr diff`) against this module's DoD and `03-TEST-PLAN.md`; fix anything found.
6. Merge only when everything passes: `gh pr merge --squash --delete-branch`. Then `git checkout main && git pull`.
7. Update `docs/PROVEN.md` (if anything was proven live) in the same PR. Never push directly to `main`; never merge red CI; never skip hooks.
