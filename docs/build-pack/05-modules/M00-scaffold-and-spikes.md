# M00 — Scaffold, public repo, CI & spikes (Day 1, Nov 9–10)
**Goal:** working monorepo on a **public GitHub repo with CI and protected main**, plus answers to every ⚠ unknown before features.
**Depends on:** nothing. **[HUMAN]** steps inside.

## Steps
1. **[HUMAN] H0 GitHub:** `gh auth login` (if not logged in). Then the agent runs: `gh repo create gnanam1990/layover --public --description "Your trip's guardian — saves money before you fly, rescues you when it breaks. Kite Passport × SERV Reasoning." --clone` (or `--source . --push` if the folder already exists). Add topics: `gh repo edit --add-topic kite-ai,x402,serv-reasoning,ai-agents,travel,hackathon`.
2. Create repo tree exactly as `02-TDD.md §2`; pnpm workspaces; root scripts: `dev` (concurrently: mocks, proxies, core, web), `test`, `typecheck` (tsc -b), `lint` (eslint + prettier --check), `demo:act1`, `demo:act2`. License Apache-2.0 (kite-x402-hono is Apache-2.0; keep its NOTICE attribution).
3. **CI:** `.github/workflows/ci.yml` — on pull_request + push to main: setup Bun 1.3 + pnpm + Node 22, `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm typecheck`, `pnpm test` (no secrets; live suites skipped). Add `.github/pull_request_template.md` (sections: Module, What changed, Tests added, Verification evidence, Tx links, DoD checklist).
4. **Protect main:** `gh api -X PUT repos/gnanam1990/layover/branches/main/protection` with required status check `ci`, require PR, no force push (if API plan doesn't allow, record in DECISIONS.md and still follow the PR flow manually).
5. `.gitignore` (node_modules, .env*, .kite-passport, *.db, services/mocks/.state.json, .next), `.env.example` from `08-reference/env.example`; `docs/DECISIONS.md`, `docs/PROVEN.md`.
6. Install deps: hono, zod, openai, viem, kite-x402-hono, next@15, tailwindcss@4, @playwright/test, concurrently, eslint, prettier, typescript.
7. **[HUMAN] H1** OpenServ: sign up at console.openserv.ai, buy credits (or use the $5), create key → `.env SERV_API_KEY`.
8. **[HUMAN] H2** Kite Passport: `curl -fsSL https://cli.gokite.ai/install.sh | bash`; `kpass signup init --email …` (or `login init`); click email link; create passkey; `kpass status --output json`; fund wallet with a few USDC.
9a. **[HUMAN] H4 Deploy target:** create a Railway (or Fly/Render) account and log in to its CLI. The agent deploys `services/mocks` (merchant) as `layover-merchant` over HTTPS and sets `MERCHANT_PUBLIC_URL`.
9b. **Sandbox:** `kpass sandbox on`; `kpass wallet address`; `kpass faucet drop --recipient <addr> --token pieUSD`.
9. **[HUMAN] H3** Merchant wallet: generate key (viem `generatePrivateKey`), put `MERCHANT_REFUND_KEY`/`MERCHANT_WALLET` in `.env`; get KITE gas (testnet faucet https://faucet.gokite.ai or small mainnet amount).

## Spikes (record each result + evidence in DECISIONS.md)
| ID | Question | How |
|---|---|---|
| S8 | **Can Passport (sandbox) pay our deployed, unlisted merchant? Does `session create` pass the catalog preflight without a catalog service?** | Deploy a minimal paywalled `/v1/book/1` on the public merchant. Create a session and `execute` it. **Success:** HTTP 200 plus a settlement tx. **`payment_target_forbidden` or preflight 404:** follow `00-context/05-feasibility-and-gaps.md §C`: open the catalog PR and send the message in `08-reference/kite-allowlist-request.md` **today**, and start F2 in parallel. |
| S9 | Exact CLI syntax | `kpass --version`, `kpass --help`, `kpass agent --help`, `kpass agent session create --help` (or `agent:session`). Record the verbs and flags (`--assets`, constraints) in DECISIONS.md and in the argv table of `kpass.ts`. |
| S1 | Which network/asset does sandbox Passport pay on? | `kpass sandbox on`; `kpass wallet balance --output json`; with the deployed merchant (H4) on `KITE_NETWORK=testnet`, create a small session (`--max-amount-per-tx 0.05 --max-total-amount 1 --assets pieUSD --ttl 1h`), approve, then `execute` against `$MERCHANT_PUBLIC_URL/v1/book/1`. Record network/asset; keep `PRICE_SCALE=100`. (Runs together with S8.) |
| S2 | Can sessions be scoped to endpoints? | `kpass agent:session create --help`; look for constraints/allowlist flags; record. |
| S3 | Dynamic price per request in x402 middleware? | Read `@x402/hono` README/types for a price function. Yes → single proxy; else tier proxies (TDD §6.2). |
| S4 | Paid flight-status service in Kite catalog? | `ksearch services list --query flight --payment-approach x402_http --limit 10 --output json`. |
| S5 | SERV works with key + models + tools? | One chat completion with `gpt-5.4-mini` + json_schema + `serv_prompt_guard` + `serv_shadow_agent`; one with `gpt-5.4-mini-serv-kronos`; record latency. |
| S6 | Rule-pack facts vs official texts | eur-lex 261/2004, transportation.gov airconsumer refunds, DGCA CAR S3 M IV. Mark each VERIFY row CONFIRMED (quote+URL) or keep VERIFY. |
| S7 | ~~Does `kpass execute` reach localhost?~~ | **Resolved: no.** Passport calls merchants server-side, so deploy publicly (H4). |

## Tests
Smoke: `pnpm lint && pnpm typecheck && pnpm test` pass on the empty scaffold; CI green on the first PR; `pnpm dev` boots; `curl :8787/health` ok.

## DoD
Public repo exists with CI + PR template (+ protection or DECISIONS note); merchant deployed on public HTTPS; S1–S9 answered (S8 decides the fallback rung); one real $0.001 x402 tx in PROVEN.md; `.env` filled locally (never committed).

## Ship it (GitHub flow — required for every module)
1. Work on branch `mxx-<slug>` (created at module start from latest `main`).
2. Small commits while working (`feat(Mxx): …`, `test(Mxx): …`, `fix(Mxx): …`).
3. Before opening the PR run locally and paste results in the PR body: `pnpm lint`, `pnpm typecheck`, `pnpm test` (plus `LIVE=1` suites named in this module if they apply).
4. `gh pr create --base main --title "Mxx: <title>" --body-file .github/PR_BODY.md` using the PR template (what changed, tests added, verification evidence, tx links if any, DoD checklist ticked).
5. Wait for **CI green** (`gh pr checks --watch`). Self-review the diff (`gh pr diff`) against this module's DoD and `03-TEST-PLAN.md`; fix anything found.
6. Merge only when everything passes: `gh pr merge --squash --delete-branch`. Then `git checkout main && git pull`.
7. Update `docs/PROVEN.md` (if anything was proven live) in the same PR. Never push directly to `main`; never merge red CI; never skip hooks.
