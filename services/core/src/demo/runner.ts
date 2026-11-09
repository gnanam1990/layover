/**
 * Scripted demo runs for recording and the M12 acceptance run.
 *   pnpm demo:act1   reset → protect (passkey) → drop Hotel Lumen to $58 → wait refund_verified
 *   pnpm demo:act2   cancel LH761 with a voucher-offer notice → wait rescue_booked + claim_ready
 * Talks to a running core (CORE_URL) exactly like the UI does, and prints every KiteScan link.
 */
type Ev = {
  id: string;
  type: string;
  title: string;
  detail?: string;
  simulated: boolean;
  links?: { label: string; url: string }[];
};

const CORE = process.env.CORE_URL ?? "http://localhost:8787";
const TOKEN = process.env.LAYOVER_LOCAL_TOKEN ?? "change-me";
const TRIP = "trip_demo";
const act = process.argv[2];

async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${CORE}${path}`, {
    method,
    headers: { "content-type": "application/json", "x-layover-token": TOKEN },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  const j = (await res.json().catch(() => ({}))) as T & { error?: string; hint?: string };
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${j.error ?? ""} ${j.hint ?? ""}`);
  return j;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const timeline = () => call<Ev[]>("GET", `/trips/${TRIP}/timeline`);

async function waitFor(types: string[], timeoutMs: number, since = 0): Promise<Ev[]> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const evs = (await timeline()).filter((e) => Number(e.id) > since);
    if (types.every((t) => evs.some((e) => e.type === t))) return evs;
    const err = evs.find((e) => e.type === "error");
    if (err) console.log(`  ! ${err.title}${err.detail ? ` — ${err.detail}` : ""}`);
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${types.join(", ")}`);
    await sleep(1500);
  }
}

function print(evs: Ev[]) {
  for (const e of evs) {
    console.log(`  ${e.simulated ? "[sim] " : "      "}${e.type.padEnd(17)} ${e.title}`);
    for (const l of e.links ?? [])
      if (l.url.startsWith("http")) console.log(`  ${" ".repeat(24)}↳ ${l.label}: ${l.url}`);
  }
}

async function ensureProtected() {
  await call("POST", "/demo/seed");
  let d = await call<{ trip: { status: string }; session: { status: string; approvalUrl?: string } | null }>(
    "GET",
    `/trips/${TRIP}`,
  );
  if (d.trip.status === "protected") return;
  if (d.session?.status !== "requested") {
    const p = await call<{ approvalUrl: string }>("POST", `/trips/${TRIP}/protect`, {});
    console.log(`\nApprove the trip budget with your passkey:\n  ${p.approvalUrl}\n`);
  }
  const h = await call<{ payer: string }>("GET", "/health");
  if (h.payer === "fake") await call("POST", "/demo/approve", { tripId: TRIP });
  for (let i = 0; i < 200; i++) {
    d = await call("GET", `/trips/${TRIP}`);
    if (d.trip.status === "protected") return console.log("Protected ✓");
    await sleep(3000);
  }
  throw new Error("session not approved within 10 minutes");
}

async function main() {
  const h = await call<{ payer: string; serv: string; network: string; now: string }>("GET", "/health");
  console.log(`core ${CORE} · payer=${h.payer} · serv=${h.serv} · ${h.network} · clock ${h.now}`);
  if (h.payer === "fake" || h.serv !== "serv")
    console.log("NOTE: offline/fake mode — not valid for PROVEN.md");
  if (act === "act1") {
    await call("POST", "/demo/reset");
    await ensureProtected();
    if (h.payer !== "fake") {
      // Live: pay the original booking through Kite too, so the refund comes from money the merchant received.
      const o = await call<{ confirmation: string; tx?: string }>("POST", "/demo/book-original", {
        tripId: TRIP,
      });
      console.log(`Original booking paid via Kite: ${o.confirmation}${o.tx ? ` · tx ${o.tx}` : ""}`);
    }
    const since = Math.max(0, ...(await timeline()).map((e) => Number(e.id)));
    await call("POST", "/demo/price", { hotelId: "lumen-goa", roomClass: "standard", newPrice: 58 });
    print(await waitFor(["refund_verified"], 5 * 60_000, since));
  } else if (act === "act2") {
    await ensureProtected();
    const since = Math.max(0, ...(await timeline()).map((e) => Number(e.id)));
    await call("POST", "/demo/flight", {
      id: "LH761-2026-12-20",
      state: "cancelled",
      reasonClass: "technical",
      noticeText:
        "Due to operational reasons your flight LH761 has been cancelled. You have been rebooked on LH763 2026-12-21 08:40Z or may request a voucher.",
    });
    print(await waitFor(["rescue_booked", "claim_ready"], 5 * 60_000, since));
  } else {
    console.log("usage: runner.ts act1|act2");
    process.exit(2);
  }
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
