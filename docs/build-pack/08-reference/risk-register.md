# Risk register
| # | Risk | Likelihood | Impact | Mitigation / owner |
|---|---|---|---|---|
| R0 | **Passport refuses our unlisted merchant (`payment_target_forbidden`) or session preflight needs a catalog service** | M | **H** | Deploy the merchant Day 1; S8 Day 1; catalog PR + Kite allowlist message same day; F2/F3 fallback ladder (05-feasibility §C) |
| R1 | Sandbox not available on our account | L | M | Use mainnet USDC.e with PRICE_SCALE=100 and ~$5 funded [HUMAN] |
| R2 | ~~localhost reachability~~ resolved: merchant deployed on public HTTPS (Railway/Fly/Render) | — | — | Health check `/healthz` in core `/health` |
| R3 | Route-tier config API differs in `@x402/hono` | M | L | S3; fallback: official typescript-express template behind a path router |
| R4 | Facilitator doesn't support chosen network | L | H | `/readyz` check in M03; switch network per S1 |
| R5 | Rule amounts wrong | M | H | Rule packs + confidence; S6; VERIFY → "up to"; disclaimer |
| R6 | SERV latency spikes during demo | M | M | Pre-warm calls; cache explanations per scenario; record with retakes |
| R7 | Passkey approval friction on video | M | L | Pre-approve session; separate 10 s clip of approval |
| R8 | Refund tx slow to confirm | L | M | Poll with UI "Refund pending"; record after confirmation |
| R9 | CI flaky (Playwright) | M | M | Retries=1 in CI only for e2e; keep unit tests deterministic |
| R10 | Scope overrun | M | H | Day plan exit criteria; cut list |
| R11 | Secrets leaked in public repo | L | H | .gitignore, pre-commit secret scan (`gitleaks` optional), review each PR |
