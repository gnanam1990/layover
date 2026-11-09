/**
 * Runs the whole stack fully offline for UI work and Playwright:
 * merchant (simulated facilitator) + core (FakePassport, SERV offline stub, demo clock) + web.
 * Never use this for the recorded demo: /health and the top bar flag "Fake payer" and "SERV offline stub".
 *
 *   bun scripts/dev-offline.ts            # dev servers
 *   bun scripts/dev-offline.ts --prod     # web from `next build` output (used by Playwright in CI)
 */
import { join } from "node:path";
import { tmpdir } from "node:os";

const root = join(import.meta.dir, "..");
// Spawn by absolute path: on Windows `bun`/`pnpm` are .cmd shims that a direct spawn can't resolve.
const BUN = process.execPath;
const NODE = Bun.which("node") ?? "node";
const NEXT = join(root, "apps/web/node_modules/next/dist/bin/next");
const prod = process.argv.includes("--prod");
const run = Date.now();
const MERCHANT_PORT = Number(process.env.OFFLINE_MERCHANT_PORT ?? 8601);
const CORE_PORT = Number(process.env.OFFLINE_CORE_PORT ?? 8787);
const WEB_PORT = Number(process.env.OFFLINE_WEB_PORT ?? 3000);
const TOKEN = "offline-token";
const ADMIN = "offline-admin";

// Bun auto-loads the repo's .env into process.env. Offline mode must never see real keys or settings
// (e.g. MERCHANT_REFUND_KEY, SERV_API_KEY), so every app variable from .env.example is dropped first.
const APP_KEYS = (await Bun.file(join(root, ".env.example")).text())
  .split("\n")
  .map((l) => /^([A-Z0-9_]+)=/.exec(l.trim())?.[1])
  .filter((k): k is string => !!k);
const inherited = Object.fromEntries(Object.entries(process.env).filter(([k]) => !APP_KEYS.includes(k)));

const shared = {
  ...inherited,
  DEMO_MODE: "1",
  LAYOVER_LOCAL_TOKEN: TOKEN,
  ADMIN_TOKEN: ADMIN,
  PRICE_SCALE: "100",
  KITE_NETWORK: "testnet",
};

const procs = [
  Bun.spawn([BUN, "src/main.ts"], {
    cwd: join(root, "services/mocks"),
    env: {
      ...shared,
      PORT: String(MERCHANT_PORT),
      FACILITATOR_URL: "sim",
      MERCHANT_PUBLIC_URL: `http://localhost:${MERCHANT_PORT}`,
      MERCHANT_WALLET: "0x1111111111111111111111111111111111111111",
      MOCK_STATE_FILE: join(tmpdir(), `layover-offline-state-${run}.json`),
      CORE_URL: `http://localhost:${CORE_PORT}`,
    },
    stdout: "inherit",
    stderr: "inherit",
  }),
  Bun.spawn([BUN, "src/main.ts"], {
    cwd: join(root, "services/core"),
    env: {
      ...shared,
      CORE_PORT: String(CORE_PORT),
      MERCHANT_URL: `http://localhost:${MERCHANT_PORT}`,
      PAYER: "fake",
      SERV_API_KEY: "",
      LAYOVER_DB: join(tmpdir(), `layover-offline-${run}.db`),
      DEMO_NOW: "2026-12-20T19:30:00Z",
      DROPWATCH_INTERVAL_MS: "3000",
      FLIGHT_POLL_MS: "2000",
    },
    stdout: "inherit",
    stderr: "inherit",
  }),
  Bun.spawn([NODE, NEXT, prod ? "start" : "dev", "-p", String(WEB_PORT)], {
    cwd: join(root, "apps/web"),
    env: { ...shared, CORE_URL: `http://localhost:${CORE_PORT}`, PORT: String(WEB_PORT) },
    stdout: "inherit",
    stderr: "inherit",
  }),
];

const stop = () => {
  for (const p of procs) p.kill();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
await Promise.race(procs.map((p) => p.exited));
stop();
