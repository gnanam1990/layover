# Hackathon brief: SERV Hackathon 02 (OpenServ), Kite track

Sources: https://openserv.ai/hackathon-2 (read 2026-11-08) · https://x.com/gokiteai/status/2117604331986079982

## Facts
- **Dates:** Nov 2–15, 2026, online. **Submissions close Nov 15, 23:59 UTC.** Winners are announced later on X; prizes are paid after verification.
- **Prizes:** $5,000 across all tracks (2 track winners, best overall build, special mention).
- **Tracks:** Dolphin, **Kite**, Reppo, Open. **Every project must use SERV Reasoning.**
- **Kite track brief:** "Build agents with a verifiable identity and spending limits you control, so it can shop, book, and pay on your behalf, safely."
  - Kite's post adds: "verifiable identity; user-defined permissions and spending limits; agentic payments for real tasks."
  - Priority repos: `BrKDDD/kite-x402-hono` (Layover's mock merchants use it; say so in the write-up), `CarryWang/kite-x402-explorer`, `tianzeshi-study/kite-x402-axum`, `gokite-ai/kite_counter_dapp`.
- **Judging:** **creativity, user readiness, revenue potential.**
- **Submission** (https://openserv.typeform.com/submissions02):
  - public repo
  - demo link or video
  - short write-up: what it does, how it uses SERV Reasoning, which track
  - **link to an X post** (required)
- **Accounts:** an OpenServ account and API key from console.openserv.ai (pre-registered participants got $5 of credits), and a Kite Passport (`kpass`).
- **Existing work:** allowed if the write-up explains what was built during the hackathon. Layover is new; it reuses patterns (not code drops) from the owner's repos, and the write-up says so.

## Judging map
| Criterion | What judges must see in ≤ 3 minutes | Built in |
|---|---|---|
| **Creativity** | One agent covers the whole trip: it saves money before the flight (an automatic price-drop rebook) and rescues you during a disruption (books a hotel at 2 a.m. from a pre-approved budget, and says "don't take the voucher, you'd lose a $412 refund"). No past hackathon project does either (0 database matches). | M06, M07, M08, M11 |
| **User readiness** | Add a trip in 30 seconds, approve one Kite Passport session with a passkey, then get push-style alerts, one-tap confirmations, plain-English rights and a ready-to-send claim. | M04, M09, M11 |
| **Revenue potential** | 30% of rebook savings (the price-drop rebooking model already has 50k users, at Repriced); a $4.99 per-trip protection fee; a share of claim payouts (the claim-agency model). On screen: "Saved $14 · our fee $4.20" and "Claim value: €400". | PRD §8, M11, write-up |

## Competitors visible in the Kite track (X, Nov 7–8)
- **PurseStrings** (@Big14teru): spend caps plus a red team. **LaunCheck** (@Story91_): an agent buys browser checks and brings receipts. Both are infrastructure-flavored.
- **Layover is the only travel and consumer-rights entry seen.** Don't pitch caps, receipts or escrow; Kite already ships those. Pitch the money saved and the stress removed.
