import type { Hex } from "viem";
import { openDb, type Db } from "./db";
import { OffsetClock, systemClock, type Clock } from "./clock";
import type { Config } from "./config";
import { TimelineStore } from "./timeline/store";
import { TripRepo } from "./trips/repo";
import { createMerchantClient, type MerchantClient } from "./merchant/client";
import { createChainVerifier, type ChainVerifier } from "./chain/verify";
import type { PassportAdapter } from "./passport/adapter";
import { KpassPassport } from "./passport/kpass";
import { FakePassport } from "./passport/fake";
import { DirectX402Payer } from "./passport/direct";
import { SessionManager } from "./passport/session-manager";
import { createServClient, type ServClient } from "./serv/client";
import { createOfflineServ } from "./serv/offline";
import { Rebooker } from "./dropwatch/rebook";
import { DropWatcher } from "./dropwatch/watcher";
import { ClaimBuilder } from "./claims/pack";
import { RescueOrchestrator } from "./rescue/orchestrator";
import { DisruptionDetector } from "./disruption/detector";

export interface Services {
  cfg: Config;
  db: Db;
  clock: Clock;
  timeline: TimelineStore;
  trips: TripRepo;
  merchant: MerchantClient;
  chain: ChainVerifier;
  passport: PassportAdapter;
  sessions: SessionManager;
  serv: ServClient;
  servOffline: boolean;
  rebooker: Rebooker;
  watcher: DropWatcher;
  claims: ClaimBuilder;
  rescue: RescueOrchestrator;
  detector: DisruptionDetector;
}

export interface ServiceOverrides {
  db?: Db;
  clock?: Clock;
  timeline?: TimelineStore;
  merchantFetch?: typeof globalThis.fetch;
  passport?: PassportAdapter;
  serv?: ServClient;
  chain?: ChainVerifier;
  sleep?: (ms: number) => Promise<void>;
}

/** Wires every core service from config; tests override the edges (fetch, passport, SERV, chain, clock). */
export function buildServices(cfg: Config, o: ServiceOverrides = {}): Services {
  const db = o.db ?? openDb(cfg.dbPath);
  const clock = o.clock ?? (cfg.demoNow ? new OffsetClock(cfg.demoNow) : systemClock);
  const timeline = o.timeline ?? new TimelineStore(db, clock);
  const trips = new TripRepo(db, clock);
  const merchantFetch = o.merchantFetch ?? globalThis.fetch;
  const merchant = createMerchantClient(cfg.merchantUrl, merchantFetch);
  const chain =
    o.chain ??
    createChainVerifier({
      network: cfg.network,
      ...(process.env.KITE_RPC_URL && { rpcUrl: process.env.KITE_RPC_URL }),
    });
  const passport: PassportAdapter =
    o.passport ??
    (cfg.payer === "fake"
      ? new FakePassport({ fetch: merchantFetch, clock, tokenDecimals: cfg.tokenDecimals })
      : cfg.payer === "direct" && cfg.directAgentKey
        ? new DirectX402Payer({
            privateKey: cfg.directAgentKey as Hex,
            chainId: cfg.network === "mainnet" ? 2366 : 2368,
            tokenDecimals: cfg.tokenDecimals,
          })
        : new KpassPassport());
  const sessions = new SessionManager({
    db,
    clock,
    timeline,
    passport,
    trips,
    priceScale: cfg.priceScale,
    merchantUrl: cfg.allowedOrigins[0] ?? cfg.merchantUrl,
  });
  const servOffline = !o.serv && (cfg.servOffline || !cfg.servApiKey);
  const serv =
    o.serv ?? (servOffline ? createOfflineServ() : createServClient({ apiKey: cfg.servApiKey!, db }));
  let wallet: string | undefined;
  const refundTo = async () => (wallet ??= (await passport.walletAddress()) ?? cfg.merchantWallet);
  const rebooker = new Rebooker({
    db,
    clock,
    timeline,
    trips,
    sessions,
    merchant,
    chain,
    refundTo,
    merchantWallet: cfg.merchantWallet,
    token: { address: cfg.tokenAddress, decimals: cfg.tokenDecimals },
    priceScale: cfg.priceScale,
    ...(o.sleep && { sleep: o.sleep }),
  });
  const watcher = new DropWatcher({
    clock,
    timeline,
    trips,
    sessions,
    merchant,
    rebooker,
    allowedOrigins: cfg.allowedOrigins,
  });
  const claims = new ClaimBuilder({ db, clock, timeline, trips, serv });
  const rescue = new RescueOrchestrator({
    clock,
    timeline,
    trips,
    sessions,
    merchant,
    serv,
    chain,
    allowedOrigins: cfg.allowedOrigins,
    refundTo,
    buildClaim: async (info) => {
      await claims.build(info);
    },
  });
  const detector = new DisruptionDetector({
    clock,
    db,
    timeline,
    trips,
    merchant,
    serv,
    onDisruption: (info) => rescue.handle(info),
  });
  return {
    cfg,
    db,
    clock,
    timeline,
    trips,
    merchant,
    chain,
    passport,
    sessions,
    serv,
    servOffline,
    rebooker,
    watcher,
    claims,
    rescue,
    detector,
  };
}
