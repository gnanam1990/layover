# Live runbook: mainnet + real data

Goal: real Kite Passport payments on **Kite mainnet**, real SERV Reasoning calls, real flight and hotel data, and transaction links in `docs/PROVEN.md`.

**Expected cost:** about **$2.5 in total**.
- Bookings at the 1:100 demo scale: $0.72 + $0.58 + $0.96 = **$2.26 paid**, and $0.72 comes back as the Act 1 refund.
- Real-data lookups: about **$0.20–0.50** (flight status $0.01, hotel search $0.05, hotel rate $0.02).

Run `pnpm preflight` at any point: it checks everything below, spends nothing, and says what to fix.

## Your steps (only you can do these)
1. **Kite Passport account.** In PowerShell, run `& "$env:USERPROFILE\.kpass\bin\kpass.exe" signup init --email <your email>`. If you already have an account, use `login init` instead of `signup init`. Follow the email link and create your passkey.
2. **Live mode.** Run `& "$env:USERPROFILE\.kpass\bin\kpass.exe" sandbox off`.
3. **Fund the Passport wallet with about $5 of USDC.** Get your addresses with `kpass.exe wallet address`, then top up from the Passport dashboard, or send USDC on Base to your Passport Base address. Passport routes payments to Kite itself.
4. **Account allowance for real data.** In the Passport dashboard, allow about $2 a day for Layover. If it's missing, the first data purchase prints a link to set it.
5. **SERV API key.** Create one at console.openserv.ai (at least $1 of credits) and add `SERV_API_KEY=...` to `.env`. Never paste it in chat.
6. Reply **"done"**.

## Agent steps (after your "done")
1. `pnpm preflight`: every item should be ✅ except the public URL.
2. **Public merchant URL.** I download `cloudflared`, Cloudflare's official release from github.com/cloudflare/cloudflared (about 65 MB), and run a quick tunnel (no account needed) for the merchant on :8601. Then I set `MERCHANT_PUBLIC_URL`. Kite Passport pays merchants from its own servers, so localhost doesn't work.
3. **Spikes:**
   - S5: one live SERV call
   - S9 and S8: one $0.01 payment to `/v1/book/1` through Passport
   - Results go into DECISIONS, and the transaction into PROVEN.md.
4. **Act 1** (`pnpm demo:act1`):
   - You approve the trip budget once with your passkey (the link is printed).
   - The original hotel is paid through Kite ($0.72).
   - The price drop then rebooks it ($0.58).
   - The old booking is refunded through the facilitator ($0.72).
   - The refund is verified on KiteScan.
5. **Act 2** (`pnpm demo:act2`): flight cancelled → voucher warning → hotel paid ($0.96) → claim.
6. **Real data:** add a real flight that's in the air this week, plus a hotel you know with the price paid. Check the live status and rates, each with its BaseScan receipt.
7. PROVEN.md (all transaction links), README "What is proven", then release v1.0.0.

## Your steps after that
Record the video (`docs/build-pack/07-demo-and-submission/video-storyboard.md`), post the X thread (`docs/SUBMISSION.md`) and submit the form.

## If something blocks
- **`payment_target_forbidden` / preflight 404** (Passport won't pay an unlisted merchant): open the catalog PR and send the allowlist message (`docs/build-pack/08-reference/kite-allowlist-request.md`). Meanwhile run the bookings on testnet (`kpass sandbox on`, `KITE_NETWORK=testnet`) and keep real data on mainnet.
- **The facilitator refuses merchant-signed refunds:** set `REFUND_VIA=gas` and put a little KITE in the merchant wallet.
- **SERV errors:** `pnpm preflight` shows the status. The app falls back to deterministic text, and the timeline says so.
