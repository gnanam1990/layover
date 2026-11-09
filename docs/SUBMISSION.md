# Submission pack (SERV Hackathon 02 · Kite track)

Form: https://openserv.typeform.com/submissions02 · deadline Nov 15 23:59 UTC (target 12:00 UTC).

## Write-up (≤ 300 words, paste into the form)
**Layover — your trip's guardian (Kite track)**

**What it does.** Layover watches your trip after you book. *Before you fly*, it rebooks your refundable hotel when the price drops: it pays the new booking first, then cancels the old one and verifies the refund on-chain (demo: saved $14). *When your flight breaks*, it works out your passenger rights (EU261/UK261, US DOT, India DGCA), warns you not to accept a voucher that would cost you your cash refund, books a care hotel from a trip budget you approved once, and drafts your claim with every receipt.

**How it uses SERV Reasoning.** Every language step is a bounded, schema-forced SERV call: TripIntake (prompt guard on pasted emails), NoticeParse (prompt guard + shadow agent on untrusted airline notices), RightsExplain (Kronos; a post-check rejects any number not in the rules engine's output), OptionRank, and ClaimDraft (shadow agent; a post-check rejects invented amounts, receipts or booking references). Money and entitlements are decided by deterministic code; SERV parses, explains and drafts.

**How it uses Kite.** One passkey-approved Kite Agent Passport session per trip (per-booking and total caps, TTL to checkout) pays every booking through `kpass` x402 execution; cap errors stop and ask, never retry. Refunds are verified on Kite chain by decoding the token transfer. Kite's rails stay rails: Layover adds the travel intelligence.

**Revenue.** 30% of rebook savings, $4.99 per-trip protection, optional success fee on claims.

**Built during the hackathon:** everything in this repo (new project, Nov 9–15). Hotels and flight status are simulated (labeled Simulated); payments and refunds are real transactions on Kite testnet — links in README → What is proven. [State the payment rung here if F2/F3 was used.]

## X thread draft
1/ Agents can book and pay now. But who watches your trip *after* you pay? Meet Layover, your trip's guardian, built on @gokiteai Agent Passport + @openservai SERV Reasoning for #SERVHackathon. 🧵 [video]
2/ Before you fly: your hotel drops from $72 to $58. Layover pays the new booking through Kite *first*, then cancels the old one and checks the $72 refund on-chain. Saved $14.
3/ Travel day: LH761 is cancelled at 9 pm. Layover's first words: don't accept the voucher. EU261 owes you a hotel tonight and up to €600. It already booked one, 6 km away, inside the budget you approved with one passkey tap.
4/ SERV reads the airline notice (prompt guard + shadow agent) and explains your rights, but code decides money and entitlements. Every number in the claim letter is checked against your records.
5/ Repo, proofs (KiteScan links) and write-up: https://github.com/gnanam1990/layover

## Checklist
| Item | Status |
|---|---|
| Public repo, CI green on main | ✅ |
| README "What is proven" with ≥ 3 KiteScan links | ⏳ needs live run (Kite login + SERV key) |
| Video ≤ 3:00 (`docs/build-pack/07-demo-and-submission/video-storyboard.md`) | ⏳ owner records |
| X post | ⏳ owner posts |
| Form submitted + confirmation screenshot in `docs/` | ⏳ owner |
| Release v1.0.0 | ⏳ after the live run |
