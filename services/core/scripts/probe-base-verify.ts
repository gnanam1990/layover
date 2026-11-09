/**
 * Free live check of the Base payment verifier: take a real, recent USDC transfer on Base and confirm the
 * verifier accepts the exact amount and rejects a wrong one. Uses Alchemy when ALCHEMY_API_KEY is set,
 * Base's public RPC otherwise (which allows ~5 req/s and refuses log searches, so this reads blocks).
 *   bun --env-file=../../.env scripts/probe-base-verify.ts
 */
import { createPublicClient, decodeEventLog, http, parseAbiItem, type Hex } from "viem";
import { BASE_USDC, baseRpc, createBaseVerifier } from "../src/realdata/base-verify";

const TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const rpc = baseRpc();
const client = createPublicClient({
  transport: http(rpc.url, { timeout: 20_000, retryCount: 4, retryDelay: 1500 }),
});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const latest = await client.getBlockNumber();
let found: { tx: Hex; from: string; value: bigint } | undefined;
for (let i = 3n; i < 9n && !found; i++) {
  await sleep(1200);
  const block = await client
    .getBlock({ blockNumber: latest - i, includeTransactions: true })
    .catch(() => null);
  // A direct USDC transfer(to, amount) call: selector 0xa9059cbb on the USDC contract.
  const t = block?.transactions.find(
    (x) => x.to?.toLowerCase() === BASE_USDC.toLowerCase() && x.input.startsWith("0xa9059cbb"),
  );
  if (!t) continue;
  await sleep(1200);
  const r = await client.getTransactionReceipt({ hash: t.hash }).catch(() => null);
  const log = r?.logs.find((l) => l.address.toLowerCase() === BASE_USDC.toLowerCase());
  if (!log) continue;
  const { from, value } = decodeEventLog({ abi: [TRANSFER], topics: log.topics, data: log.data }).args as {
    from: string;
    value: bigint;
  };
  found = { tx: t.hash, from, value };
}
if (!found) throw new Error("no recent direct USDC transfer found in the last blocks");

const v = createBaseVerifier(rpc);
await sleep(1200);
const ok = await v.verify(found.tx, { from: found.from, amountAtomic: found.value });
await sleep(1200);
const wrong = await v.verify(found.tx, { from: found.from, amountAtomic: found.value + 1n });
console.log(`source=${rpc.source} tx=${found.tx} amount=${found.value}`);
console.log(`exact amount → ${ok} · amount+1 → ${wrong}`);
if (ok !== true || wrong !== false) process.exit(1);
