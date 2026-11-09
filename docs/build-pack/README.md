# Layover build pack: START HERE

**Layover is your trip's guardian.** It saves you money before you fly, and it rescues you when the flight breaks.
- **Before the trip (Dropwatch):** it watches your refundable hotel booking. When the price drops, it books the cheaper rate first, then cancels the old one, verifies the refund on-chain and shows what you saved.
- **On travel day (Rescue):** when your flight is cancelled or badly delayed, it knows your passenger rights (US DOT, EU261/UK261, India DGCA). It books a hotel or ride from a trip emergency budget you approved in advance, tells you which airline offers to **decline** so you keep your refund, and drafts your refund/compensation claim with every receipt attached.

It's being built for the **SERV Hackathon 02, Kite track** (OpenServ × Kite AI): "agents that can shop, book and pay on your behalf, safely". **Submissions close 2026-11-15 23:59 UTC.** Aim to submit by **12:00 UTC on Nov 15**.

This pack holds everything a coding agent needs to build Layover from an empty repo. It was written on 2026-11-09 from the hackathon page, the Kite and SERV docs, Kite's priority sample repos, a 132k-project hackathon database, and the owner's repos (GitHub `gnanam1990`).

## How to use it (new chat)
1. Create an empty folder and git repo named `layover/`.
2. Unzip this pack into `layover/docs/build-pack/`.
3. Copy `docs/build-pack/CLAUDE.md` to `layover/CLAUDE.md`.
4. Open a new chat in `layover/` and paste the contents of **`06-prompts/00-bootstrap.md`**.
5. The agent first creates the **public GitHub repo `gnanam1990/layover`** with CI and a protected `main` (M00). It then builds the modules **one at a time** (order in CLAUDE.md). **Each module is a branch and a pull request: lint, typecheck and tests pass, CI is green, the agent self-reviews against the DoD, then squash-merges into `main`.** Only then does it start the next module. Each has a spec (`05-modules/`) and a ready prompt (`06-prompts/`). After each module, paste the next prompt, or tell the agent "continue with the next module".
6. **[HUMAN]** steps are yours. The agent stops and gives exact instructions for each:
   - create the OpenServ account and API key, and buy credits
   - install `kpass` and approve with your passkey
   - fund the Passport wallet and get testnet faucet gas
   - record the video, post on X and submit the form

## Reading order for the agent
| # | File | Purpose |
|---|---|---|
| 1 | `00-context/01-hackathon-brief.md` | Rules, judging, submission, deadline, competitors |
| 2 | `01-PRD.md` | What and why: users, stories, acceptance criteria, scope, revenue |
| 3 | `02-TDD.md` | How: architecture, data models, flows, APIs, LLM call graph, security |
| 4 | `03-TEST-PLAN.md` | Tests to write **first**, for every module |
| 5 | `04-UIUX-SPEC.md` | Kite-themed design system and every screen |
| 6 | `00-context/02-sponsor-docs-digest.md` | Exact Kite Passport, x402 and SERV facts (⚠ = verify in a spike) |
| 7 | `00-context/03-passenger-rights-rules.md` | Rule tables for DOT, EU261, UK261 and DGCA, with confidence and sources |
| 7b | **`00-context/05-feasibility-and-gaps.md`** | **Verified facts, gaps, fallback ladder. Read before M00.** |
| 8 | `05-modules/` then `06-prompts/` | Module specs and prompts |
| 9 | `07-demo-and-submission/` | Demo script, storyboard, write-up, X thread, checklist |
| 10 | `08-reference/` | env.example, JSON schemas, day plan, risks, cut list, glossary |

## Non-negotiables
- **SERV Reasoning** powers all LLM reasoning (hackathon rule). **Kite Agent Passport** makes every payment (track rule).
- **Kite features are rails, not the pitch.** Sessions, caps, receipts and escrow already exist in Kite. Layover's value is travel-disruption intelligence and price-drop recovery.
- **Code decides money and entitlements, never the model.** The policy gate and the rights engine are pure, table-tested functions. SERV parses, explains and drafts.
- **Honesty:** hotels and flight status are mock services in the demo, and airline claims are drafted, not auto-filed. The README's "What is proven" section lists real tx hashes.
- **Deliverables:** a public repo, a demo video ≤ 3 minutes, a write-up and an X post. The form is https://openserv.typeform.com/submissions02.
