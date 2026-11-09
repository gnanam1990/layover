# Layover

**Your trip's guardian.** Layover saves you money before you fly and rescues you when the flight breaks. You approve its spending limits once with your Kite Agent Passport.

- **Dropwatch (before the trip):** watches your refundable hotel booking. When the price drops it books the cheaper rate first, then cancels the old one, verifies the refund on-chain and shows what you saved.
- **Rescue (travel day):** when your flight is cancelled or badly delayed it assesses your passenger rights (US DOT, EU261/UK261, India DGCA), books a hotel from a trip emergency budget you approved in advance, warns you which airline offers to decline, and drafts your claim with every receipt attached.

Built for **SERV Hackathon 02 — Kite track** (OpenServ × Kite AI). All LLM reasoning runs on **SERV Reasoning**; every payment goes through **Kite Agent Passport**.

> Work in progress. See `docs/build-pack/` for the full plan, `docs/DECISIONS.md` for spike results and `docs/PROVEN.md` for live transactions.

## Run
```bash
pnpm install
cp .env.example .env
pnpm dev
```

## Layout
- `apps/web` — Next.js 15 UI (Kite theme)
- `services/core` — Hono on Bun: API, agents, rights engine, policy gate
- `services/mocks` — mock hotel merchant (x402 paywall), flight feed, demo admin
- `packages/shared` — zod schemas, money math, passenger-rights rule packs

## License
Apache-2.0
