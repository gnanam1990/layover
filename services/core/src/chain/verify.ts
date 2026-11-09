import { createPublicClient, decodeEventLog, http, parseAbi, type Hex, type PublicClient } from "viem";

export type KiteNetwork = "mainnet" | "testnet";

export const ERC20_ABI = parseAbi([
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "function transfer(address to, uint256 value) returns (bool)",
  "function balanceOf(address owner) view returns (uint256)",
]);
export const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef" as const;

export const CHAIN_IDS: Record<KiteNetwork, number> = { mainnet: 2366, testnet: 2368 };
export const DEFAULT_RPC: Record<KiteNetwork, string> = {
  mainnet: "https://rpc.gokite.ai",
  testnet: "https://rpc-testnet.gokite.ai",
};

export function explorerTx(hash: string, network: KiteNetwork): string {
  return network === "mainnet" ? `https://kitescan.ai/tx/${hash}` : `https://testnet.kitescan.ai/tx/${hash}`;
}

export interface ReceiptLike {
  status: "success" | "reverted";
  logs: { address: string; topics: readonly Hex[] | Hex[]; data: Hex }[];
}

export interface RefundExpectation {
  token: string;
  from: string;
  to: string;
  amountAtomic: bigint;
}

const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Pure check: the receipt succeeded and contains Transfer(from → to, amount) on `token`, exactly. */
export function verifyRefundInReceipt(receipt: ReceiptLike, exp: RefundExpectation): boolean {
  if (receipt.status !== "success") return false;
  for (const log of receipt.logs) {
    if (!eq(log.address, exp.token)) continue;
    if (!log.topics[0] || !eq(log.topics[0], TRANSFER_TOPIC)) continue;
    try {
      const ev = decodeEventLog({
        abi: ERC20_ABI,
        eventName: "Transfer",
        topics: log.topics as [Hex, ...Hex[]],
        data: log.data,
      });
      const { from, to, value } = ev.args as { from: string; to: string; value: bigint };
      if (eq(from, exp.from) && eq(to, exp.to) && value === exp.amountAtomic) return true;
    } catch {
      // not a standard Transfer log; ignore
    }
  }
  return false;
}

export interface ChainVerifier {
  verifyPayment(tx: Hex): Promise<boolean>;
  verifyRefund(tx: Hex, exp: RefundExpectation): Promise<boolean>;
  explorerTx(tx: string): string;
}

export function createChainVerifier(opts: { network: KiteNetwork; rpcUrl?: string }): ChainVerifier {
  const client: PublicClient = createPublicClient({
    transport: http(opts.rpcUrl ?? DEFAULT_RPC[opts.network], { timeout: 15_000 }),
  });
  const receipt = async (hash: Hex): Promise<ReceiptLike | null> => {
    try {
      return (await client.getTransactionReceipt({ hash })) as unknown as ReceiptLike;
    } catch {
      return null; // not mined yet / unknown
    }
  };
  return {
    async verifyPayment(tx) {
      return (await receipt(tx))?.status === "success";
    },
    async verifyRefund(tx, exp) {
      const r = await receipt(tx);
      return r ? verifyRefundInReceipt(r, exp) : false;
    },
    explorerTx: (tx) => explorerTx(tx, opts.network),
  };
}
