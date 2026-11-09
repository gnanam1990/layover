import { createApp } from "./app";

const port = Number(process.env.CORE_PORT ?? 8787);
const app = createApp();
console.log(`layover-core listening on :${port}`);
export default { port, fetch: app.fetch };
