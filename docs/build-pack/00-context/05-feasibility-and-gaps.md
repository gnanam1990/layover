# Feasibility and gaps audit (2026-11-09, read this before M00)

**Verdict: FEASIBLE in 6 days**, with the changes below already applied in this pack. The plan was re-checked against the Kite docs (`llms/docs.txt`), the **Kite changelog**, the **official catalog repo `gokite-ai/kite-x402-services`**, the priority repos and the SERV docs.

## A. Verified facts (with source)
| # | Fact | Source |
|---|---|---|
| V1 | **Passport fetches merchant URLs from Kite's servers.** Localhost and browser-gated tunnels don't work, so a merchant needs a public HTTPS origin. | kite-x402-services README "Go live", CONTRIBUTING "Public https origin" |
| V2 | **Sandbox mode:** `kpass sandbox on` pays with free **pieUSD on Kite testnet**; `kpass faucet drop --recipient <addr> --token pieUSD`; `kpass wallet address`. | kite-x402-services README "Test with a Kite Passport agent" |
| V3 | You can pay your **own, not-yet-listed** service from a Passport agent: the documented flow is "pay one call yourself, then open the catalog PR". | kite-x402-services README and CONTRIBUTING step 7 |
| V4 | Catalog status lifecycle: `draft → testnet → live`; a manifest is required (`service.yaml`, closed schema). | CONTRIBUTING |
| V5 | **Charge only on success:** verify → upstream → settle, settling only when the upstream status is < 400. | CONTRIBUTING rules; kite-x402-axum |
| V6 | Testnet `eip155:2368`, pieUSD `0x38129cf4CE5E183eFF248F42A7D345Bb1B47621A` (18 decimals; EIP-712 name `pieUSD`, version `1`). Mainnet `eip155:2366`, USDC.e `0x7aB6f3ed87C42eF0aDb67Ed95090f8bF5240149e` (6 decimals; name `Bridged USDC (Kite AI)`, version `2`). Facilitator `https://facilitator.pieverse.io/v2` (keep `/v2`). | kite-x402-services README network table |
| V7 | **Session caps are USD-denominated.** The backend dropped the token allowlist; the merchant chooses the settlement stablecoin. The CLI still shows `--assets` (`pieUSD` in sandbox, `USDC` live). | Changelog 2026-06 backend; catalog README |
| V8 | High-risk actions (`wallet.send`, `agent_session.approve`) require a **fresh passkey step-up each time**. Wallet sends can't be autonomous; x402 execute under an approved session can. | Changelog 2026-06 backend |
| V9 | Session creation runs a **catalog preflight** (estimated fees; 404 service-not-found is surfaced). | Changelog 2026-05-19 |
| V10 | The x402 catalog uses **allowlisted hosts**; new hosts are "reachable … without requesting manual allowlisting" once added. | Changelog (13 new services) |
| V11 | Passport is multichain: Kite, Arc mainnet, Base (Aave repay), and Solana settlement. The Kite payment MCP was removed on 2026-09-01; use the CLI and skills only. | Changelog 2026-07/09/10 |
| V12 | SERV: OpenAI-compatible at `https://inference-api.openserv.ai/v1`; a system prompt is required; `serv_prompt_guard`, `serv_shadow_agent` (schema-default params), `-serv-kronos`, json_schema structured outputs. | docs.openserv.ai |

## B. Gaps found, and how the plan now handles them
| Gap | Severity | Resolution in this pack |
|---|---|---|
| G1. Localhost mock merchants can't be paid (V1) | **Critical** | The mock merchant (hotel upstream plus x402 paywall) is **deployed to public HTTPS on Day 1** (Railway, Fly or Render). Core and web can stay local. See M00 step H4 and M03. |
| G2. Is an unlisted host payable? (V3 vs V10) | High | **Spike S8:** pay the deployed merchant in sandbox. If refused with `payment_target_forbidden`: (a) open the catalog PR (`service.yaml`, status `testnet`) and ask Kite in Telegram/Discord for allowlisting (message drafted in `08-reference/kite-allowlist-request.md`); (b) meanwhile use the fallback in TDD §5.3. |
| G3. One fixed price per kite-x402-hono instance | Medium | **Route-tier pricing in one deployment**: `@x402/hono` `paymentMiddleware` with one route per tier (`POST /v1/book/58`, `/v1/book/72`, …). kite-x402-hono stays as reference/attribution. Spike S3 confirms the route config API. |
| G4. `--assets` and command syntax drift (`agent:session` vs `agent session`) | Medium | **Spike S9:** `kpass --version`, `kpass agent --help`, `kpass agent session create --help`. The adapter builds argv from a single table so a rename is one edit. |
| G5. Real money for the demo | Low | Use **sandbox/testnet pieUSD (free)** for the whole demo; mainnet is optional at the end. `PRICE_SCALE=100` keeps faucet needs small (display $72, settle 0.72 pieUSD). |
| G6. Wallet-send step-up (V8) | Low | Layover never uses user-side `wallet send`. Refunds are merchant → user, signed by the merchant key on the server. |
| G7. Catalog preflight may reject sessions not tied to catalog services (V9) | Medium | S8 also checks that `session create` works with no catalog service; if not, run it after the catalog PR (G2a) and record the result. |
| G8. Passenger-rights amounts partly unverified | Medium | Rule packs carry confidence; S6 confirms against official texts; VERIFY shows as "up to" plus a disclaimer. |
| G9. Merchant wallet needs gas | Low | `kpass faucet drop` / https://faucet.gokite.ai for KITE gas on testnet [HUMAN]. |
| G10. Schedule (13 modules in 6 days) | Medium | Day plan with exit criteria, the cut list, and M10 built early. Mocks are deployed on Day 1 so S8 doesn't block Act 1. |

## C. Fallback ladder if Passport can't pay the merchant by end of Day 2
1. **F1 (preferred):** the catalog PR is merged or the host is allowlisted by Kite; continue as designed.
2. **F2:** pay through an **already allowlisted catalog service** for the parts that are real data (S4: travel data / flight status), and run hotel booking on a **testnet x402 path the agent pays via the facilitator directly** (an EIP-3009 signer in core using a funded testnet agent key). The UI labels it "direct x402 (testnet)". Kite Passport still approves the trip session and pays real catalog data calls.
3. **F3 (last resort):** a per-booking `kpass wallet send` with a passkey step-up, so the user taps once per booking. The demo stays honest: "Layover asks you to tap once to pay".

Record the chosen rung in DECISIONS.md. The write-up and README must state it.

## D. Things still unknown (spikes)
S1 sandbox network and asset · S2 session endpoint constraints · S3 route-tier pricing in `@x402/hono` · S4 catalog travel/flight data services · S5 SERV key and tools · S6 rule-pack official texts · S8 unlisted host payable plus catalog preflight · S9 CLI syntax. (S7 is resolved by V1: deploy publicly.)
