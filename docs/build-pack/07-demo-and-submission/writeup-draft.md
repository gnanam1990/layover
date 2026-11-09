# Write-up (paste into the form; ≤ 300 words)
**Layover — your trip's guardian (Kite track)**

**What it does.** Layover watches your trip after you book. *Before you fly*, it rebooks your refundable hotel when the price drops — paying the new booking first, cancelling the old one, and verifying the refund on-chain (demo: saved $14). *When your flight breaks*, it knows your passenger rights (EU261/UK261, US DOT, India DGCA), books a care hotel from a trip budget you approved once, warns you not to accept a voucher that would forfeit your cash refund, and drafts your claim with every receipt.

**How it uses SERV Reasoning.** Every reasoning step is a bounded, schema-forced SERV call: TripIntake (prompt guard on pasted emails), NoticeParse (prompt guard + shadow-agent validation on untrusted airline notices), RightsExplain (Kronos-audited; cannot introduce numbers not in the rules engine output), OptionRank, and ClaimDraft (shadow agent ensures no invented entitlement). Money and entitlements are decided by deterministic code; SERV parses, explains and drafts.

**How it uses Kite.** One passkey-approved Kite Agent Passport session per trip (per-booking and total caps, TTL to checkout) funds every action via `kpass` x402 execution; merchants run on the Kite priority repo **kite-x402-hono**; refunds and payments are verified on Kite chain. Kite's rails stay rails — Layover adds the travel intelligence.

**Revenue.** 30% of rebook savings, $4.99/trip protection, optional success fee on claims.

**Built during the hackathon:** everything in this repo (new project). Patterns reused from the author's earlier open-source work (flowops policy engine, uptimebuyer bounded-spend recovery). Hotels and flight status are simulated; payments and refunds are real on-chain transactions on Kite testnet via Passport sandbox (tx links in README → What is proven). [If a fallback rung F2/F3 was used, state it here.]
