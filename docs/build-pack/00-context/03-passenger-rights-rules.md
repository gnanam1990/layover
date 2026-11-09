# Passenger-rights rule packs (encode as data, never as prose in a prompt)

The rights engine (M07) is **deterministic code over JSON rule packs** in `packages/shared/rules/*.json`. SERV only parses notices into facts and explains the engine's output in plain English.

**Confidence levels:**
- **HIGH:** consistent across sources and matches the regulation's well-known structure.
- **MEDIUM:** the sources partly disagree.
- **VERIFY:** the agent must confirm against the official text in spike **S6** before showing a cash amount.

The UI must show "Based on <rule pack> v<date>, not legal advice" and link the official source. Amounts marked VERIFY show as "may be owed: up to X", never as "you are owed X".

## Pack `eu261`: EU Regulation (EC) 261/2004
**Applies when** the flight departs from an EU/EEA airport (any airline), **or** arrives in the EU/EEA on an EU-licensed airline. *(HIGH)*

**Distance bands** use great-circle distance from the airport coordinates in `airports.json`:

| Band | Distance | Compensation | Care starts after a departure delay of |
|---|---|---|---|
| A | ≤ 1,500 km | €250 | 2 h |
| B | intra-EU > 1,500 km, or any 1,500–3,500 km | €400 | 3 h |
| C | > 3,500 km (non-intra-EU) | €600 | 4 h |

*(Amounts and bands HIGH. Care thresholds MEDIUM.)*

**Compensation:**
- **Cancellation:** compensation is due unless the passenger was told **≥ 14 days before departure** *(HIGH)*. Shorter notice can be exempted when a qualifying re-route is offered. Treat the shorter-notice re-route exemptions as VERIFY.
- **Delay:** compensation is due when **arrival** at the final destination is **≥ 3 h late** (Sturgeon case law) *(HIGH)*.
- **Extraordinary circumstances** (weather, ATC, security, airport closure) remove the **cash compensation only**, never the right to care *(HIGH)*.
- A long-haul delay of 3–4 h may be reduced by 50%. VERIFY.

**Right to care** (no exemption for extraordinary circumstances) *(HIGH)*:
- meals and refreshments
- **a hotel when an overnight stay becomes necessary**, plus transfers
- 2 calls or emails

**If the airline doesn't provide care:** the passenger may buy reasonable care and claim reimbursement with receipts *(HIGH)*. **This is the core of Layover's rescue: Layover buys the hotel and records the receipt for reimbursement.**

**Cancellation (or a delay of ≥ 5 h):** the passenger chooses a refund **or** re-routing *(HIGH)*.

**Voucher warning:** accepting a voucher instead of cash is optional; cash refund is the default *(HIGH)*.

Official text: https://eur-lex.europa.eu/eli/reg/2004/261/oj

## Pack `uk261`: UK retained Regulation 261
Same structure as EU261 for flights departing the UK, or arriving in the UK on a UK or EU airline. Amounts are **£220 / £350 / £520** for bands A/B/C *(MEDIUM, so VERIFY)*. Official guidance: https://www.caa.co.uk

## Pack `us_dot`: US DOT automatic refund rule (14 CFR 260, in effect from late Oct 2024)
- **Cancellation, or a significant change, then the passenger declines the alternative:** an automatic **cash refund** to the original form of payment, regardless of cause *(HIGH)*.
- **Significant delay:** a departure or arrival change of **≥ 3 h domestic** or **≥ 6 h international**. Whether the threshold is measured on departure or arrival is MEDIUM, so VERIFY.
- **Refund timing:** 7 business days for card purchases, 20 calendar days for other forms of payment *(MEDIUM)*.
- **No federal cash compensation for delays.** The proposed rule was withdrawn in 2025 *(HIGH)*.
- **Meals and hotels** depend on the airline's own customer-service commitments (the DOT dashboard), mostly for **controllable** causes *(MEDIUM)*. Show them as "Airline commitment, check the airline", not as a legal right.
- **Voucher warning (the key Layover insight):** accepting a voucher, credit or re-booking **can forfeit the cash refund**. Layover must warn before the user accepts anything *(HIGH)*.

Official: https://www.transportation.gov/airconsumer · dashboard https://www.transportation.gov/airconsumer/airline-customer-service-dashboard

## Pack `in_dgca`: India DGCA CAR Section 3, Series M, Part IV
**Cancellation:**
- Told **≥ 14 days** before departure: no compensation *(MEDIUM)*.
- Shorter notice: an alternate flight or a full refund, **plus** compensation unless **force majeure** applies (weather, ATC, security, political disturbance, industrial action) *(MEDIUM)*.

**Cancellation compensation by block time** *(VERIFY)*:

| Block time | Compensation |
|---|---|
| ≤ 1 h | ₹5,000 |
| 1–2 h | ₹7,500 |
| > 2 h | ₹10,000 |

The total is capped at the booked one-way basic fare plus fuel surcharge (VERIFY). Some sources quote international amounts of ₹10,000 / ₹20,000 (VERIFY).

**Delays:**
- Meals at **2 h+** (by block time).
- At **6 h+**, an alternate flight or a full refund.
- If a delay of **24 h+** (or overnight), a hotel.

All delay rules are *(MEDIUM)*. **Sources conflict on cash compensation for pure delays, so treat it as not owed unless S6 confirms.**

**Denied boarding** is out of scope for the demo.

Official: https://www.dgca.gov.in (search "CAR Section 3 Series M Part IV"). Complaint portal: AirSewa https://airsewa.gov.in

## Engine output contract (see `08-reference/schemas/rights-assessment.json`)
For each applicable pack: `entitlements[]`, each of `{ kind: refund|compensation|care_meal|care_hotel|care_transport|reroute, amount?, currency?, confidence, basis, source_url }`. Also:
- `do_not[]`, e.g. "Do not accept a voucher if you want cash"
- `actions[]`, e.g. "Ask the desk for a hotel voucher first; if refused, Layover books and you claim it back"
- `evidence_needed[]`
- `rule_pack_versions`

When several packs apply (for example an EU departure on a US airline), output each pack separately and highlight the **best** remedy.

## Sources consulted (blogs; use only to cross-check)
[Squaremouth](https://www.squaremouth.com/travel-advice/airline-passenger-rights) · [withautopilot](https://withautopilot.com/blog/flight-delay-compensation) · [flightelite](https://www.flightelite.app/blog/flight-delay-compensation-guide/) · [flyhelp EU care](https://flyhelp.com/eu-passenger-rights-when-a-flight-is-delayed/) · [happyfares DGCA](https://www.happyfares.in/blog/flight-delay-rights-india-2026/) · [Tribune: DGCA fines Air India Express ₹10 lakh for unpaid compensation](https://www.tribuneindia.com/news/india/dgca-slaps-rs-10-lakh-fine-on-air-india-express)
