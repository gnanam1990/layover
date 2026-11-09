# Kite allowlisting request (use only if spike S8 gets `payment_target_forbidden`)

## 1. Catalog PR (gokite-ai/kite-x402-services)
- Path: `services/layover-demo-hotels/` containing the wrapper source, `README.md` and `service.yaml`.
- Follow CONTRIBUTING: public HTTPS, `npm run validate`, pay one call yourself, paste the output in the PR.
```yaml
schema: 1
name: layover-demo-hotels
display_name: Layover Demo Hotels (hackathon)
description: >-
  Demo hotel booking merchant for the Layover agent (SERV Hackathon 02, Kite track).
  Books simulated rooms, priced per booking in pieUSD on Kite testnet; refunds on cancel.
maintainer:
  github: gnanam1990
status: testnet
network: eip155:2368
pay_to: "0xYOUR_MERCHANT_WALLET"
upstream:
  name: Layover demo inventory
  url: https://github.com/gnanam1990/layover
  requires_api_key: false
  terms_url: https://github.com/gnanam1990/layover/blob/main/LICENSE
source: typescript-hono
endpoints:
  - method: POST
    path: /v1/book/58
    summary: Book a demo room at the $58 tier (settles 0.58 pieUSD at PRICE_SCALE=100).
    price_usd: "0.58"
    example_request:
      body: { hotelId: lumen-goa, roomClass: standard, checkIn: "2026-12-22", checkOut: "2026-12-24", refundTo: "0x..." }
    pitfalls:
      - "Returns 409 price_changed (not settled) if the tier no longer matches the live price; re-quote first."
categories: [travel, commerce]
tags: [hotel, booking, demo, hackathon]
```
⚠ Check every key against `schema/service.schema.json` (the schema is closed), and adjust `source` to an allowed value.

## 2. Message to the Kite team (Telegram or Discord dev channel)
> Hi Kite team. I'm building **Layover** for the SERV Hackathon 02 Kite track: an agent that rebooks hotels on price drops and books care hotels when flights are cancelled, paying through Kite Passport sessions.
> My demo merchant is deployed at `https://<host>` (x402 v2, Pieverse facilitator, testnet pieUSD, settles only on upstream < 400). Passport sandbox returns `payment_target_forbidden` when paying it.
> I opened catalog PR <link>. Could you allowlist the host for testnet so I can demo by Nov 15? Happy to change anything in the manifest. Thanks!
