import { createApp } from "./app";
import { loadConfig } from "./config";
import { buildServices } from "./services";

const cfg = loadConfig();
const services = buildServices(cfg);
const app = createApp({ services, localToken: cfg.localToken });

// Background loops share the app's serialized tick chain with the demo buttons (no interleaving).
setInterval(() => void app.tickAll("dropwatch"), cfg.dropwatchMs);
setInterval(() => void app.tickAll("flights"), cfg.flightPollMs);

console.log(
  `layover-core on :${cfg.port} · payer=${services.passport.kind} · serv=${services.servOffline ? "OFFLINE STUB" : "SERV"} · merchant=${cfg.merchantUrl} · demo=${cfg.demoMode}${cfg.demoNow ? ` · clock=${services.clock.now().toISOString()}` : ""}`,
);
export default { port: cfg.port, fetch: app.fetch, idleTimeout: 0 };
