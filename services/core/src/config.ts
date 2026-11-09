export type PayerKind = "passport" | "direct" | "fake";

export interface Config {
  priceScale: number;
  /** Where core reaches the merchant's free routes (may be local). */
  merchantUrl: string;
  /** Origins the policy gate lets Layover pay (the public merchant). */
  allowedOrigins: string[];
  network: "testnet" | "mainnet";
  tokenAddress: string;
  tokenDecimals: number;
  merchantWallet: string;
  payer: PayerKind;
  directAgentKey?: string;
  servApiKey?: string;
  /** Deterministic offline stand-in for SERV (tests and offline dev only; flagged in /health and the UI). */
  servOffline: boolean;
  demoMode: boolean;
  adminToken: string;
  localToken: string;
  dbPath: string;
  /** Demo clock start (e.g. 2026-12-20T19:30:00Z) so the December trip is "today" during recording. */
  demoNow?: string;
  dropwatchMs: number;
  flightPollMs: number;
  port: number;
}

const originOf = (u: string) => {
  try {
    return new URL(u).origin;
  } catch {
    return "";
  }
};

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const network = env.KITE_NETWORK === "mainnet" ? "mainnet" : "testnet";
  const publicUrl = env.MERCHANT_PUBLIC_URL || "";
  const merchantUrl = env.MERCHANT_URL || publicUrl || "http://localhost:8601";
  const allowed = (env.ALLOWED_MERCHANT_ORIGINS ?? "")
    .split(",")
    .map((s) => originOf(s.trim()))
    .filter(Boolean);
  const payer = (["passport", "direct", "fake"] as const).find((p) => p === env.PAYER) ?? "passport";
  return {
    priceScale: Number(env.PRICE_SCALE ?? 100),
    merchantUrl,
    allowedOrigins: allowed.length ? allowed : [originOf(publicUrl || merchantUrl)].filter(Boolean),
    network,
    tokenAddress:
      env.KITE_TOKEN_ADDRESS ||
      (network === "mainnet"
        ? "0x7aB6f3ed87C42eF0aDb67Ed95090f8bF5240149e"
        : "0x38129cf4CE5E183eFF248F42A7D345Bb1B47621A"),
    tokenDecimals: Number(env.KITE_TOKEN_DECIMALS || (network === "mainnet" ? 6 : 18)),
    merchantWallet: env.MERCHANT_WALLET || "0x0000000000000000000000000000000000000001",
    payer,
    ...(env.DIRECT_AGENT_KEY && { directAgentKey: env.DIRECT_AGENT_KEY }),
    ...(env.SERV_API_KEY && { servApiKey: env.SERV_API_KEY }),
    servOffline: env.SERV_OFFLINE === "1" || !env.SERV_API_KEY,
    demoMode: env.DEMO_MODE === "1",
    adminToken: env.ADMIN_TOKEN || "change-me",
    localToken: env.LAYOVER_LOCAL_TOKEN || "change-me",
    dbPath: env.LAYOVER_DB || "layover.db",
    ...(env.DEMO_NOW && { demoNow: env.DEMO_NOW }),
    dropwatchMs: Number(env.DROPWATCH_INTERVAL_MS ?? 15000),
    flightPollMs: Number(env.FLIGHT_POLL_MS ?? 5000),
    port: Number(env.CORE_PORT ?? 8787),
  };
}

export function testConfig(over: Partial<Config> = {}): Config {
  return {
    ...loadConfig({}),
    payer: "fake",
    servOffline: true,
    demoMode: true,
    adminToken: "adm1n",
    localToken: "t0k",
    dbPath: ":memory:",
    merchantUrl: "https://merchant.test",
    allowedOrigins: ["https://merchant.test"],
    merchantWallet: "0x1111111111111111111111111111111111111111",
    ...over,
  };
}
