# Research evidence, prior art and builder assets

## The problem is real and common
- **Hotel prices drop after booking.**
  - Drops occur in 23–57% of bookings, saving about $62 each ([RatePunk, 28k tracked rebookings](https://www.ratepunk.com/blog/ever-tracked-hotel-price-after-booking-in-57-of-the-cases-you-would-have-saved-data-shows); [Arbitrip, 23% of bookings, Aug 2026](https://thebusinesstravelmag.com/arbitrip-adds-price-drop-tool/)).
  - The market exists: Repriced passed 50k users and $25M of bookings tracked ([Apr 2026](https://www.galvnews.com/repriced-surpasses-50-000-users-and-25m-in-bookings-tracked-helping-travelers-automatically-save-when/article_c9b49144-c001-5b74-81a2-d8394184e1c5.html)), and Ramp offers price-drop rebooking for business travel ([Ramp](https://support.ramp.com/hc/en-us/articles/38708993715859-Hotel-Price-Drop)).
- **Flight disruptions strand travelers, and people lose money they're owed.**
  - Under the DOT automatic-refund rule, accepting a voucher or rebooking can forfeit the cash refund.
  - EU261 owes €250–600 per qualifying disruption, plus hotel and meals regardless of cause.
  - The EU logged 165k air-passenger complaints in 2025 ([withautopilot](https://withautopilot.com/blog/flight-delay-compensation), [Squaremouth](https://www.squaremouth.com/travel-advice/airline-passenger-rights), [AirAdvisor](https://airadvisor.com/en/statistics/global-flight-cancellations)).
  - In India the DGCA fined Air India Express ₹10 lakh for not paying cancellation compensation ([Tribune](https://www.tribuneindia.com/news/india/dgca-slaps-rs-10-lakh-fine-on-air-india-express)).
- **On X**, people describe agents that "do everything you asked and still give a result you never wanted" when booking hotels ([post](https://x.com/encrypt_26/status/2108805199909257218)). Users want guardrails plus outcomes, not just booking.

## Why it isn't a sponsor feature
| Already in Kite or SERV (used as rails only) | What Layover adds (the product) |
|---|---|
| Passport sessions, per-tx and total caps, TTL, `execution_constraints`, allowance, x402 pay, receipts, escrow/refund primitives, merchant allowlists, delegation proof | Price surveillance and a safe rebook order (book new → cancel old → verify refund); disruption detection; a passenger-rights engine (DOT, EU/UK261, DGCA); "decline the voucher" protection; care booking for reimbursement; claim drafting with an evidence pack |
| SERV prompt guard, shadow agent, structured outputs, Kronos | Travel-domain call graphs: notice parsing, rights explanation, option ranking, claim drafting |

## Prior art (Hackathon Atlas, 132k projects, 2026-11-09)
- `landscape "hotel price drop rebooking agent"`: **0** core matches.
- `landscape "flight cancelled rebook compensation claim"`: **0** core matches.
- **Kite's past winners** (ETHDenver 2026) were concrete consumer actions: VybPass (tickets, 1st), KiteClaw, Colony, AgentMarkets.
- **The generic agent-payments space** has 1,039 projects and a below-average win rate (10.9% vs 17.1%). A sharp consumer use case beats another rail.

## Builder assets to reuse (patterns, not code dumps)
| Layover module | Repo | Pattern to lift |
|---|---|---|
| M04 Passport adapter | `gnanam1990/kitepass-sdk`, `kitepass-mcp`, `uptimebuyer` | Kite Passport auth/session/x402 wrappers; uptimebuyer's broker-isolated bounded spend |
| M05 Policy gate | `gnanam1990/flowops`, `sherpa` | Deterministic authorize → approve → envelope; safety checks before any wallet prompt |
| M07 Rights engine | `gnanam1990/flowops` (policy as data) | Rule packs plus evaluation with reasons |
| M08 Rescue | `gnanam1990/uptimebuyer` | Incident → evidence-bound plan → bounded spend → close only on proof |
| M09 Claims / M10 Timeline | `gnanam1990/corporate-action-guard`, `capitaldesk` | Signed receipts; recoverable order evidence |
| M11 UI | `gnanam1990/sherpa` (confirmation cards), `kiteindex`, `kitepulse` (Kite UIs) | Card flows; Kite-palette components |
| M03 Mocks | `BrKDDD/kite-x402-hono` (priority repo) | x402 reverse proxy for paid merchant endpoints |
