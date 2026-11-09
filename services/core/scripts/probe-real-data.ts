/**
 * Free check of the real-data URLs Layover builds: each provider should answer 402 (payment required),
 * which means it accepts the request shape. Nothing is paid.   bun scripts/probe-real-data.ts
 */
import { AIRPORT_LOOKUP, FLIGHTAWARE } from "../src/realdata/flights";
import { HOTELS } from "../src/realdata/hotels";

const q = (o: Record<string, string>) => new URLSearchParams(o).toString();
const stay = { check_in_date: "2026-11-12", check_out_date: "2026-11-13", adults: "2", currency: "USD" };
const urls = [
  `${FLIGHTAWARE}/UA123?ident_type=designator&start=2026-11-12T00:00:00Z&end=2026-11-13T00:00:00Z&max_pages=1`,
  `${AIRPORT_LOOKUP}?code=ORD`,
  `${HOTELS}/search?${q({ query: "hotels near Chicago OHare airport", ...stay })}`,
  `${HOTELS}/property?${q({ property_token: "ChkI0Nqb_63cnPoTGg0vZy8xMWJ4ZjNoMXloEAE", ...stay })}`,
];

for (const u of urls) {
  const r = await fetch(u, { signal: AbortSignal.timeout(20_000) });
  const pr = r.headers.get("payment-required");
  const a = pr
    ? (JSON.parse(Buffer.from(pr, "base64").toString()) as { accepts: { network: string; amount: string }[] })
        .accepts[0]
    : null;
  const what = a ? `${a.network} $${Number(a.amount) / 1e6}` : (await r.text()).slice(0, 120);
  console.log(r.status, what, "<-", new URL(u).host + new URL(u).pathname);
}
