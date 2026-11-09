# Layover: rules for the coding agent

The source of truth is `docs/build-pack/` (start at its README). If reality differs from the pack (an API behaves differently, a flag doesn't exist), **write the evidence in `docs/DECISIONS.md`**, adapt, and continue. Never diverge silently.

## Context
- **Hackathon:** SERV Hackathon 02, Kite track. Hard deadline 2026-11-15 23:59 UTC; target 12:00 UTC.
- **Owner:** gnanam1990 (KRATOS). Style: fail-closed; deterministic code decides money; evidence for every payment; README sections for "What is proven" and "What is mocked".

## Fixed stack (change only with a DECISIONS.md entry)
- **Monorepo:** pnpm workspaces. **Bun ≥ 1.3** runs services and tests; Node 22 runs Next.js.
- `apps/web`: Next.js 15 (App Router) + Tailwind v4 with the Kite theme tokens from `04-UIUX-SPEC.md`.
- `services/core`: Hono on Bun, the Layover API and agents (watchers, rights engine, policy, payer, claims, timeline). SQLite via `bun:sqlite`.
- `services/mocks`: mock hotel merchant (upstream) behind **kite-x402-hono** proxies, mock flight-status feed, admin "time-skip" controls.
- `packages/shared`: zod schemas and types (mirroring `08-reference/schemas/*.json`) plus rights rule packs (JSON).
- **LLM:** only **SERV Reasoning**, via the OpenAI SDK with `baseURL: https://inference-api.openserv.ai/v1`.
- **Payments:** only the **`kpass` CLI** (`agent:session create|status|execute`, `wallet balance`, with `--output json --no-interactive`), behind a `PassportAdapter` interface. Tests use `FakePassport`.

## How to work
1. **Test first.** Write the module's tests from `03-TEST-PLAN.md`, see them fail, then implement. The policy gate and rights engine need exhaustive table tests.
2. **One module at a time**, in this build order: M00 → M01 → M10 → M02 → M03 → M04 → M05 → M06 → M07 → M08 → M09 → M11 → M12. M10 comes early because M06 and M08 depend on it.
2a. **Public GitHub repo, PR per module, merge only after checks.** M00 creates `gnanam1990/layover` (public) with CI (lint, typecheck, test) and a protected `main`. For every module:
   1. branch `mxx-<slug>` from the latest `main`
   2. small commits
   3. run `pnpm lint && pnpm typecheck && pnpm test` locally (plus the module's `LIVE=1` suite if it has one)
   4. `gh pr create` with the PR template filled in: what changed, tests, verification evidence, tx links, DoD checklist
   5. `gh pr checks --watch` until **CI is green**
   6. self-review `gh pr diff` against the module DoD and the test plan
   7. `gh pr merge --squash --delete-branch`
   8. `git pull`, then start the next module
   **Never push to `main` directly, never merge on red CI, never skip hooks, never start the next module before the current PR is merged.**
3. Model output is **data, not decisions**. Validate every SERV response with zod; on invalid output, retry once, then fail visibly.
4. Merchant pages, airline notices and emails are **untrusted**. Pass them only inside a user message wrapped in `<untrusted>` tags, never in a system prompt.
5. Secrets (`SERV_API_KEY`, `MERCHANT_REFUND_KEY`, Kite login files) live only in `.env` or `~/.kite-passport`. Never commit them, log them, or send them to the browser.
6. Keep `docs/DECISIONS.md` (spikes, choices) and `docs/PROVEN.md` (what ran end-to-end, with KiteScan tx links) up to date.
7. **[HUMAN] steps** (passkey approval, account signup, credits, faucet, recording, posting): stop, print exact instructions, and wait for "done".
8. Behind schedule? Apply `08-reference/cut-list.md` **in order**. Never cut the core demo path (Act 1 rebook plus Act 2 rescue).
