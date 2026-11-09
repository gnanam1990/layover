/**
 * Live preflight: checks everything the mainnet + real-data run needs, spends nothing, prints a checklist.
 *   pnpm preflight        (reads the repo .env; Bun loads it automatically)
 */
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { privateKeyToAccount } from "viem/accounts";

type Check = { name: string; ok: boolean | "warn"; detail: string; fix?: string };
const checks: Check[] = [];
const add = (c: Check) => checks.push(c);
const env = process.env;
const T = { signal: AbortSignal.timeout(20_000) };

const kpassBin =
  (env.KPASS_BIN && env.KPASS_BIN !== "kpass" ? env.KPASS_BIN : "") ||
  ["kpass.exe", "kpass"].map((f) => join(homedir(), ".kpass", "bin", f)).find(existsSync) ||
  "kpass";
async function kpass(args: string[]): Promise<Record<string, unknown>> {
  const p = Bun.spawn([kpassBin, ...args, "--output", "json", "--no-interactive"], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...env, KPASS_NO_BROWSER: "1" },
  });
  const out = await new Response(p.stdout).text();
  await p.exited;
  try {
    return JSON.parse(out.slice(out.indexOf("{"))) as Record<string, unknown>;
  } catch {
    return { _raw: out.slice(0, 200) };
  }
}
const get = (o: unknown, path: string): unknown =>
  path
    .split(".")
    .reduce<unknown>(
      (a, k) => (a && typeof a === "object" ? (a as Record<string, unknown>)[k] : undefined),
      o,
    );
async function rpc(method: string, params: unknown[]) {
  const r = await fetch(env.KITE_RPC_URL || "https://rpc.gokite.ai", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    ...T,
  });
  return ((await r.json()) as { result?: string }).result;
}

// ---- configuration ----
const mainnet = env.KITE_NETWORK === "mainnet";
add({
  name: "Network",
  ok: mainnet ? true : "warn",
  detail: mainnet ? "Kite mainnet (eip155:2366)" : `KITE_NETWORK=${env.KITE_NETWORK ?? "testnet"}`,
  fix: "Set KITE_NETWORK=mainnet in .env for the mainnet run",
});
add({
  name: "Payer",
  ok: (env.PAYER ?? "passport") === "passport",
  detail: `PAYER=${env.PAYER ?? "passport"}`,
  fix: "Set PAYER=passport",
});
add({
  name: "Real data",
  ok: env.REAL_DATA === "1" ? true : "warn",
  detail: `REAL_DATA=${env.REAL_DATA ?? "0"}`,
  fix: "Set REAL_DATA=1 to buy live flight/hotel data",
});

// ---- SERV ----
if (!env.SERV_API_KEY) {
  add({
    name: "SERV key",
    ok: false,
    detail: "SERV_API_KEY is empty",
    fix: "Create a key at console.openserv.ai and put SERV_API_KEY=... in .env",
  });
} else {
  const r = await fetch("https://inference-api.openserv.ai/v1/models", {
    headers: { authorization: `Bearer ${env.SERV_API_KEY}` },
    ...T,
  }).catch(() => null);
  add({
    name: "SERV key",
    ok: !!r && r.ok,
    detail: r ? `GET /v1/models → ${r.status}` : "unreachable",
    fix: "Check the key / credits at console.openserv.ai",
  });
}

// ---- Kite Passport ----
const st = await kpass(["status"]);
const loggedIn = get(st, "user.logged_in") === true;
add({
  name: "Kite login",
  ok: loggedIn,
  detail: loggedIn ? `signed in as ${String(get(st, "user.email"))}` : "not signed in",
  fix: `${kpassBin} signup init --email <you>  (or login init), then follow the email`,
});
if (loggedIn) {
  const sb = await kpass(["sandbox", "status"]);
  const mode = String(
    get(sb, "mode") ?? get(sb, "sandbox") ?? JSON.stringify(sb).match(/"(live|sandbox)"/)?.[1] ?? "unknown",
  );
  const live = /live|false|off/i.test(mode);
  add({
    name: "Passport mode",
    ok: mainnet ? live : !live,
    detail: mode,
    fix: mainnet ? `${kpassBin} sandbox off` : `${kpassBin} sandbox on`,
  });
  const al = await kpass(["allowance", "status"]);
  add({
    name: "Account allowance (real data)",
    ok: env.REAL_DATA === "1" ? (get(al, "status") === "success" ? true : false) : "warn",
    detail: String(get(al, "user_message") ?? get(al, "hint") ?? get(al, "error") ?? "unknown"),
    fix: "Set a small allowance (e.g. $2/day) for Layover in the Kite Passport dashboard",
  });
  const wb = await kpass(["wallet", "balance"]);
  add({
    name: "Passport wallet",
    ok: "warn",
    detail: JSON.stringify(get(wb, "balances") ?? get(wb, "assets") ?? wb).slice(0, 160),
    fix: "Fund ~$5 USDC (Base) into your Passport wallet",
  });
  add({
    name: "Agent registered",
    ok: get(st, "agent.registered") === true ? true : "warn",
    detail: String(get(st, "agent.agent_id") ?? "not yet (Layover registers itself on first protect)"),
  });
}

// ---- merchant wallet ----
const key = env.MERCHANT_REFUND_KEY as `0x${string}` | undefined;
if (!key || !env.MERCHANT_WALLET) {
  add({
    name: "Merchant wallet",
    ok: false,
    detail: "MERCHANT_WALLET / MERCHANT_REFUND_KEY missing",
    fix: "Ask the agent to generate one (stored only in .env)",
  });
} else {
  const addr = privateKeyToAccount(key).address;
  add({
    name: "Merchant wallet",
    ok: addr.toLowerCase() === env.MERCHANT_WALLET.toLowerCase(),
    detail: addr,
    fix: "MERCHANT_WALLET must be the address of MERCHANT_REFUND_KEY",
  });
  const gas = await rpc("eth_getBalance", [addr, "latest"]).catch(() => undefined);
  const via = env.REFUND_VIA === "gas" ? "gas" : "facilitator";
  add({
    name: "Refund path",
    ok: via === "facilitator" || BigInt(gas ?? "0x0") > 0n,
    detail:
      via === "facilitator"
        ? "facilitator settles refunds (merchant needs no KITE)"
        : `merchant pays gas · KITE balance ${BigInt(gas ?? "0x0")} wei`,
    fix: "Use REFUND_VIA=facilitator, or send a little KITE to the merchant wallet",
  });
}

// ---- public merchant ----
const pub = env.MERCHANT_PUBLIC_URL?.split("#")[0]?.trim();
if (!pub?.startsWith("https://")) {
  add({
    name: "Public merchant URL",
    ok: false,
    detail: pub || "MERCHANT_PUBLIC_URL is empty",
    fix: "Kite Passport pays from its servers: the merchant needs public HTTPS (the agent sets up a tunnel)",
  });
} else {
  const h = await fetch(`${pub}/healthz`, T)
    .then((r) => r.json() as Promise<{ network?: string }>)
    .catch(() => null);
  add({
    name: "Public merchant",
    ok: !!h,
    detail: h ? `healthz ok · ${h.network}` : "unreachable",
    fix: "Start the merchant and the tunnel",
  });
  const r = await fetch(`${pub}/v1/book/1`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
    ...T,
  }).catch(() => null);
  const pr = r?.headers.get("payment-required");
  const a = pr
    ? (JSON.parse(Buffer.from(pr, "base64").toString()) as { accepts: { network: string; payTo: string }[] })
        .accepts[0]
    : undefined;
  add({
    name: "x402 challenge",
    ok:
      !!a &&
      a.network === (mainnet ? "eip155:2366" : "eip155:2368") &&
      a.payTo.toLowerCase() === env.MERCHANT_WALLET?.toLowerCase(),
    detail: a ? `${a.network} → ${a.payTo}` : `no 402 (${r?.status ?? "unreachable"})`,
  });
}

// ---- facilitator + real data providers ----
const sup = await fetch(`${env.FACILITATOR_URL || "https://facilitator.pieverse.io/v2"}/supported`, T)
  .then((r) => r.json() as Promise<{ kinds: { network: string }[] }>)
  .catch(() => null);
const net = mainnet ? "eip155:2366" : "eip155:2368";
add({
  name: "Facilitator",
  ok: !!sup?.kinds.some((k) => k.network === net),
  detail: sup ? `supports ${net}: ${sup.kinds.some((k) => k.network === net)}` : "unreachable",
});
if (env.REAL_DATA === "1") {
  const probes = [
    "https://stabletravel.dev/api/flightaware/flights/UA123?ident_type=designator&max_pages=1",
    "https://hotels.use.x402atlas.com/search?query=Frankfurt%20airport",
  ];
  for (const u of probes) {
    const r = await fetch(u, T).catch(() => null);
    add({
      name: `Data: ${new URL(u).host}`,
      ok: r?.status === 402,
      detail: `unpaid probe → ${r?.status ?? "unreachable"}`,
    });
  }
}

// ---- report ----
const icon = (ok: Check["ok"]) => (ok === true ? "✅" : ok === "warn" ? "⚠️ " : "❌");
console.log("\nLayover live preflight\n");
for (const c of checks) {
  console.log(`${icon(c.ok)} ${c.name.padEnd(30)} ${c.detail}`);
  if (c.ok !== true && c.fix) console.log(`   ${" ".repeat(30)} → ${c.fix}`);
}
const blocking = checks.filter((c) => c.ok === false).length;
console.log(blocking ? `\n${blocking} blocking item(s).` : "\nReady for the live run.");
process.exit(blocking ? 1 : 0);
