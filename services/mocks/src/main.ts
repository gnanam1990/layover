import { createMerchantApp } from "./merchant";

const port = Number(process.env.PORT ?? process.env.MERCHANT_PORT ?? 8601);
const app = createMerchantApp();
console.log(`layover-merchant listening on :${port}`);
export default { port, fetch: app.fetch };
