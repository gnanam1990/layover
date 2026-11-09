# Layover: Product Requirements Document (v1.0, 2026-11-09)

## 1. One-liner
**Layover is your trip's guardian.** It saves you money before you fly and rescues you when the flight breaks. You approve its spending limits once with your Kite Passport.

## 2. Problem
1. **Money left on the table before the trip.** Hotel prices drop after booking in 23–57% of cases (about $62 a time). Nobody re-checks every day, so the savings are lost.
2. **Panic and lost rights during disruptions.** When a flight is cancelled at 11 p.m., travelers scramble for a hotel, accept the first voucher (which can forfeit a DOT cash refund), don't know EU261 owes them hotels and up to €600, and never file claims.
3. **Agents that pay, but can't be trusted with a trip.** Existing agents book things, but no agent watches your booking afterwards or knows your passenger rights.

## 3. Users and personas
- **Priya, 28, frequent domestic and international flyer (India ↔ EU).** Books refundable hotels, hates checking prices, and got stranded once in Frankfurt.
- **Marcus, 41, US business traveler.** Gets reimbursed for travel; wants the cash refunds he's entitled to, not vouchers.
- **(Secondary) a travel manager** who wants price-drop savings across a team. Phase 2, out of hackathon scope.

## 4. Goals and non-goals
**Goals for the hackathon:**
- G1: Add a trip (flight plus hotel booking) in under 60 seconds.
- G2: One passkey-approved Kite session funds automatic actions within user-set limits.
- G3: An end-to-end, live price-drop rebook: book new → cancel old → refund verified on-chain → savings shown.
- G4: An end-to-end, live disruption rescue: cancellation detected → rights assessed → hotel booked inside the budget → voucher warning → claim drafted with receipts.
- G5: SERV Reasoning powers every LLM step; Kite Passport makes every payment.

**Non-goals:** booking flights (airlines don't accept Kite; Layover advises on airline options only); auto-submitting legal claims (drafts only); real OTA integrations (mock merchants); legal advice.

## 5. User stories and acceptance criteria
| ID | Story | Acceptance criteria |
|---|---|---|
| US-1 | As a traveler, I add my trip by typing "LH 761 FRA→BLR Dec 20, hotel booking HX-2231 at Hotel Lumen Goa Dec 20–22" or by pasting a confirmation email. | SERV TripIntake returns a valid `Trip` (zod). Missing fields are asked for in one follow-up. The pasted email is treated as untrusted. The trip appears on the dashboard within 5 s. |
| US-2 | As a traveler, I set limits once: "Auto-rebook if I save ≥ $5. Emergency budget $150, max $120 per booking, valid until Dec 23." | The UI shows a Kite Passport session request with exactly those numbers and a TTL to trip end. After passkey approval, status shows **Protected**. Nothing auto-spends without an approved session. |
| US-3 | As a traveler, I want Layover to rebook when my hotel price drops. | The watcher detects `newPrice + fees ≤ oldPrice − minSaving`. Policy checks same hotel or better rating, same dates, room class ≥ booked, refundable. Order: **book new (x402 pay) → confirm → cancel old → verify the refund transfer on KiteScan**. The timeline shows both tx links and "Saved $X · fee $0.3X". If cancelling the old booking fails, Layover alerts and keeps both; never cancel first. |
| US-4 | As a traveler whose flight is cancelled late at night, I want a place to sleep without thinking. | Within 60 s of the cancellation event: a rights assessment is shown and a hotel is selected near the airport (≤ 10 km, rating ≥ 3.5, free cancellation, ≤ per-booking cap). It auto-books if the user enabled auto-rescue, otherwise one tap. A receipt is stored for reimbursement. |
| US-5 | As a traveler, I don't want to lose my refund by accepting the wrong offer. | When `us_dot` applies to a cancellation, the top banner reads "Don't accept a voucher or credit if you want your cash refund". When `eu261` applies, "Ask the desk for a hotel first; if refused, we book it and you claim it back". Every rule shows its source and confidence. |
| US-6 | As a traveler, I want my claim ready to send. | The ClaimPack has the airline, booking ref, the entitlements with amounts (VERIFY-confidence amounts shown as "up to"), a timeline of events, and receipts from Kite payments (tx hashes). A ready-to-send email/letter is drafted by SERV with the shadow agent validating that no unsupported claim is made. Copy and "Open email" buttons. |
| US-7 | As a traveler, I want to see everything Layover did and spent. | The Trip timeline lists every event (detection, decision with reasons, session, payment tx, refund tx, claim) with timestamps and links. A spend meter is shown against the session caps. |
| US-8 | As a judge or tester, I need to trigger events on demand. | The demo control panel (admin-only, behind `DEMO_MODE=1`) can drop a hotel price, cancel a flight or delay a flight N hours. Every trigger is labeled "Simulated" in the timeline. |

## 6. Feature list by module
| Module | Feature |
|---|---|
| M00 | Scaffold, environment, spikes S1–S6 |
| M01 | Shared schemas and domain types; rule pack data |
| M02 | SERV client (structured outputs, tools, Kronos, call log) |
| M03 | Mock merchants (hotel inventory and x402 proxies, refund sender), mock flight feed, demo controls |
| M04 | Passport adapter (`kpass`), session manager, error handling |
| M05 | Policy gate (pure) |
| M06 | Dropwatch: price watcher and safe rebook orchestrator |
| M07 | Disruption detector and passenger-rights engine (deterministic) plus SERV notice parser and explainer |
| M08 | Rescue orchestrator (care hotel/ride booking, voucher warning) |
| M09 | ClaimPack generator (SERV draft, shadow-validated, receipts) |
| M10 | Trip timeline/event store and on-chain verification |
| M11 | Web app (Kite theme): onboarding, dashboard, approve, rescue, claim, timeline, demo panel |
| M12 | Demo runner, README (proven/mocked), submission assets |

## 7. Safety and trust requirements
- Money moves **only** through an approved Kite session, and **only** after `policy.gate()` returns `allow`.
- Never cancel the old booking before the new booking is confirmed and paid.
- Every LLM output is schema-validated; untrusted text is never placed in a system prompt.
- Entitlement amounts come **only** from rule packs, never from model text.
- Kite session errors (`session_rule_exceeded`, `session_total_exceeded`, `session_endpoint_forbidden`, and others) stop the action and ask the user. They are never retried on the same session.

## 8. Revenue model (show in the write-up and UI)
1. **Savings share:** 30% of each price-drop saving, shown as "Saved $14 · fee $4.20". This is the proven model of price-drop rebooking tools.
2. **Trip protection:** $4.99 per trip, or $29/year, for disruption rescue with auto-care booking.
3. **Claim success fee:** 15% of compensation paid out (vs 25–35% at claim agencies), as an optional Phase 2.
4. **B2B:** a team plan for travel managers (pooled savings dashboard), Phase 2.

The hackathon build shows fees in the UI; it doesn't charge them.

## 9. Success metrics (demo and Phase 2)
- Demo: both acts run end-to-end live with real Kite tx hashes; time from event to action under 60 s.
- Phase 2: average savings per booking ≥ $25; claim filing rate ≥ 80% of eligible disruptions; customer acquisition cost recovered within 2 trips.

## 10. Scope cut list (in order; see `08-reference/cut-list.md`)
1. UK261 pack (keep EU261, DOT, DGCA)
2. Ride booking (hotel only)
3. Email-paste trip intake (keep typed intake)
4. The ClaimPack "letter" format (keep the JSON plus an email draft)

**Never cut:** Act 1 rebook, Act 2 rescue, the voucher warning, the timeline with tx links.

## 11. Risks
See `08-reference/risk-register.md`. The top risks: Passport network/asset unknown (S1); a fixed price per x402 proxy (S3); rule accuracy (S6); passkey approval friction in the demo (pre-approve the session before recording).
