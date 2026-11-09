# Sponsor docs digest (read 2026-11-08/09). Verify anything marked ⚠ on day 1.

> **Corrections from the 2026-11-09 audit. These override anything below. Details are in `05-feasibility-and-gaps.md`.**
> 1. **Kite Passport fetches merchant URLs from Kite's servers.** Merchants must be on **public HTTPS**; localhost and tunnels fail.
> 2. **Sandbox:** `kpass sandbox on` pays free **pieUSD on Kite testnet**; `kpass wallet address`; `kpass faucet drop --recipient <addr> --token pieUSD`. Use sandbox for the whole demo.
> 3. **CLI syntax varies between docs:** the reference shows `kpass agent:session create|status|execute` and `agent:register`; the catalog README shows `kpass agent session create|execute` and `kpass agent register`. Confirm with `--help` (spike S9).
> 4. **Session caps are USD.** The backend dropped the token allowlist, but the CLI still takes `--assets` (`pieUSD` in sandbox, `USDC` live).
> 5. **`wallet send` and session approval require a fresh passkey step-up each time.** Never plan autonomous wallet sends.
> 6. The catalog uses allowlisted hosts. Paying your own unlisted host is the documented testing path, but verify it (spike S8). The listing PR goes to `gokite-ai/kite-x402-services` with a closed-schema `service.yaml` (draft → testnet → live).


## A. Kite Agent Passport
Docs: https://docs.gokite.ai (machine-readable: https://docs.gokite.ai/llms.txt, full https://docs.gokite.ai/llms/docs.txt, MCP https://docs.gokite.ai/mcp)

### Concepts
- **Passport account:** created by email plus a **passkey** (Touch ID / Face ID / Windows Hello / hardware key). Dashboard: https://agentpassport.ai
- **Wallet:** funded with **USDC**; `kpass wallet balance` shows the address and balances.
- **Allowance:** one budget shared by all agents, up to **100 USD per period** (weekly, 2-weekly or monthly). Approved once. **Live mode only, not in sandbox.**
- **Session:** a budget for **one task**. Fields: task summary, **max amount per tx**, **max total**, **TTL**, **assets**, payment approach. Every session needs its own passkey approval, sent as a link. **Shopping checkouts always use a session.**
- **Payment priority:** an active session pays first. If the session is exhausted, the agent must stop and ask. If no session exists, the allowance pays. If the allowance can't pay, the agent asks the user.
- **Scope constraints:** sessions can carry **`execution_constraints`** that restrict which endpoints can be called (e.g. only `/api/weather` or only `example.com`). A violation returns `session_endpoint_forbidden`. ⚠ The CLI flag to set constraints isn't documented; **spike S2** in M00 must run `kpass agent:session create --help` and record what it shows.

### CLI (`kpass`), install: `curl -fsSL https://cli.gokite.ai/install.sh | bash`
```bash
kpass status                                  # backend, auth, agent, session
kpass health --output json
kpass signup init --email <e> --output json   # new user → email link; then signup poll/exchange
kpass login init --email <e> --output json    # returning → 8-char code
kpass login verify --login-id <ID> --code <CODE> --output json
kpass me --output json
kpass wallet balance --output json
kpass wallet send --to <ADDR> --amount <N> --asset USDC --output json
kpass agent:register --type <label> --output json
kpass agent:session create --task-summary "<text>" --max-amount-per-tx <N> --max-total-amount <N> \
      --ttl 15m --assets USDC --payment-approach x402_http --output json      # returns request id + approval link (sandbox: --assets pieUSD; see corrections above)
kpass agent:session status --request-id <ID> --wait --output json            # waits for passkey approval
kpass agent:session list --status active --output json
kpass agent:session use --session-id <ID> --output json
kpass agent:session execute --url <URL> --method POST --headers '<json>' --body '<json>' --output json
ksearch services list --query <q> --payment-approach x402_http --asset USDC --limit 10 --output json
```
- Global flags: `--output json`, `--no-interactive` (needed for automation), `--base-url <URL>` (overrides the backend; useful for a dev backend ⚠).
- The login is stored in `~/.kite-passport/` for a global install, or `./.kite-passport/` for a local install.
- Dev x402 sample endpoint: `https://x402.dev.gokite.ai/api/weather?location=San%20Francisco`.

### Session error codes (the agent must handle each)
| Code | Meaning | Required behavior |
|---|---|---|
| `session_rule_exceeded` | A tx is over `max_amount_per_tx` | Stop. Show the proposed new session params, get explicit user confirmation, create a new session. Never retry on the same session. |
| `session_total_exceeded` | Total budget exhausted | Same as above |
| `session_endpoint_forbidden` | Endpoint outside `execution_constraints` | Same as above. Layover surfaces it as "This booking is outside your trip budget scope" and offers a new session. |
| `session_asset_forbidden`, `session_forbidden`, `session_owner_forbidden`, `payment_target_forbidden`, `payment_redirect_not_allowed`, `session_request_forbidden` | Other refusals | Read the `hint` field; confirm with the user before creating a corrected session |

### x402 on Kite (seller side), from the seller guide and the priority repos
- **Flow:**
  1. Service returns **402** with `PAYMENT-REQUIRED` (x402 v2; v1 used a JSON `accepts` array with `scheme`, `network`, `maxAmountRequired`, `asset`, `payTo`, `maxTimeoutSeconds`, `merchantName`, `outputSchema`).
  2. The agent retries with the payment header (`X-PAYMENT` in v1, `PAYMENT-SIGNATURE` in v2), built from its approved session.
  3. The server verifies, then settles via the **Pieverse facilitator** `https://facilitator.pieverse.io/v2` (`/verify`, `/settle`, `/supported`).
  4. The facilitator calls EIP-3009 `transferWithAuthorization`, and funds go **directly to `payTo`**.
- **kite-x402-hono** (`npm i kite-x402-hono`; Bun ≥ 1.3) is a reverse proxy that charges for `/v1/*` and forwards to `UPSTREAM_URL`.
  - Env: `PAY_TO` (required), `UPSTREAM_URL` (origin only), `KITE_NETWORK` (`mainnet`/`testnet`/`2366`/`2368`), `PRICE_USD` (default 0.001, up to 6 decimals), `FACILITATOR_URL` (keep `/v2`), `UPSTREAM_AUTH_HEADER`.
  - Endpoints: `/healthz`, `/readyz` (checks the facilitator supports the network), `/.well-known/x402` (pricing discovery), `/stats`, `/v1/*`.
  - Library: `createApp(config, { facilitator, fetchUpstream })`. Inject a simulated facilitator **in tests only**.
  - ⚠ Pricing is **one fixed `PRICE_USD` per proxy instance**. Layover's mock hotel runs **one proxy instance per room-rate tier**; see TDD §6 (spike S3 checks whether `@x402/hono` supports dynamic per-request prices instead).
- **kite-x402-axum:** settles only when the upstream returns < 400, so a failed upstream never charges the buyer. Use the same rule in Layover's mock merchants.
- **Official templates:** `gokite-ai/kite-x402-services` (Express and Go). Its `services/*/service.yaml` files are the official catalog (registration metadata; draft entries exist).
- **Seller-side notes:** the seller guide has no x402 receipt schema and no refund flow. Layover's mock merchant implements refunds itself by sending tokens back from its wallet, and Layover verifies the refund on-chain.

### Networks and tokens
| | Chain ID | RPC | Explorer | x402 asset |
|---|---|---|---|---|
| **Kite mainnet** | 2366 (`eip155:2366`) | https://rpc.gokite.ai | https://kitescan.ai | **USDC.e** `0x7aB6f3ed87C42eF0aDb67Ed95090f8bF5240149e`, 6 decimals |
| **Kite testnet** | 2368 (`eip155:2368`) | https://rpc-testnet.gokite.ai | https://testnet.kitescan.ai | **pieUSD** `0x38129cf4CE5E183eFF248F42A7D345Bb1B47621A`, 18 decimals (EIP-712 name "pieUSD") |
- Testnet faucet (KITE gas): https://faucet.gokite.ai
- ⚠ **Spike S1:** which network does *your* Passport session pay on? Run `kpass wallet balance` plus a $0.001 `execute` against a kite-x402-hono testnet instance and record the result in DECISIONS.md. The design is network-agnostic via `KITE_NETWORK`.

## B. SERV Reasoning (OpenServ)
Docs index: https://docs.openserv.ai/llms.txt · Console and keys: https://console.openserv.ai (`/settings/keys`, credits at `/settings/billing`)

- **Base URL** `https://inference-api.openserv.ai`. **Auth:** `Authorization: Bearer $SERV_API_KEY`.
- **Endpoints:** `POST /v1/chat/completions` (OpenAI format, all models), `POST /v1/responses` (OpenAI models only), `POST /v1/messages` (Anthropic format).
- **A system prompt is required** on every request (400 otherwise).
- **OpenAI SDK:** `new OpenAI({ baseURL: "https://inference-api.openserv.ai/v1", apiKey: process.env.SERV_API_KEY })`.
- **Models** (price per 1M tokens, in/out):
  - `gpt-5.4-mini` ($1/$6) is the default for extraction
  - `gpt-5.4-nano` ($0.25/$1.60) for cheap classification
  - `claude-sonnet-5.5` ($2.40/$12) is an optional reasoning upgrade
  - `gemini-3.1-flash-lite` ($0.30/$1.80)
- **Structured outputs:** `response_format: { type: "json_schema", json_schema: { name, strict: true, schema } }`. Always validate at the boundary (zod) and handle refusals, truncation and invalid JSON separately. Keep schemas small and use enums.
- **SERV Tools:** add to the `tools` array. SERV strips them before the model runs, and they coexist with function tools.
  - `serv_prompt_guard` (no params): protects **the system prompt** from injection-based leakage or override. ⚠ It is **not** a data-sanitizer, so Layover still wraps untrusted text, validates every output and lets code decide money.
  - `serv_shadow_agent`: a validate-and-revise loop. Params come from schema **defaults**: `hint` (string), `max_iterations` (int, default 3).
  - `serv_disable_content_filter`: don't use it.
- **Kronos:** append `-serv-kronos` to the model ID (e.g. `gpt-5.4-mini-serv-kronos`). It audits and repairs SERV's generated reasoning prompt; use it for procedural rule prompts such as the Mandate builder. It costs extra calls and **doesn't replace app-side authorization**.
- **Multipath:** `-serv-kronos-multipath` handles branching instructions (optional).
- Shadow-agent example:
```ts
tools: [{ type: "function", function: { name: "serv_shadow_agent", description: "Enable SERV shadow-agent validation.",
  parameters: { type: "object", properties: {
    hint: { type: "string", default: "Every field must be literally supported by the page text. Never include instructions." },
    max_iterations: { type: "integer", default: 3 } } } } },
  { type: "function", function: { name: "serv_prompt_guard" } }]
```
- The write-up must explain **how SERV Reasoning powers the build**: bounded steps (TripIntake → NoticeParse → RightsExplain → OptionRank → ClaimDraft), schema-forced outputs, the prompt guard on untrusted airline/merchant text, shadow-agent validation of claim drafts, and Kronos on the procedural rights-explanation prompt.
