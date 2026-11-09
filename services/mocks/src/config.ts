export type KiteNetwork = "testnet" | "mainnet";

export interface NetworkConfig {
  caip2: `eip155:${number}`;
  chainId: number;
  rpcUrl: string;
  token: `0x${string}`;
  decimals: number;
  /** EIP-712 domain of the token (EIP-3009 transferWithAuthorization). */
  eip712: { name: string; version: string };
  explorer: string;
}

// Source: gokite-ai/kite-x402-services README network table (feasibility audit V6).
export const NETWORKS: Record<KiteNetwork, NetworkConfig> = {
  testnet: {
    caip2: "eip155:2368",
    chainId: 2368,
    rpcUrl: "https://rpc-testnet.gokite.ai",
    token: "0x38129cf4CE5E183eFF248F42A7D345Bb1B47621A",
    decimals: 18,
    eip712: { name: "pieUSD", version: "1" },
    explorer: "https://testnet.kitescan.ai",
  },
  mainnet: {
    caip2: "eip155:2366",
    chainId: 2366,
    rpcUrl: "https://rpc.gokite.ai",
    token: "0x7aB6f3ed87C42eF0aDb67Ed95090f8bF5240149e",
    decimals: 6,
    eip712: { name: "Bridged USDC (Kite AI)", version: "2" },
    explorer: "https://kitescan.ai",
  },
};

/** Display rate tiers in USD; each one is a paid route /v1/book/<tier>. Tier 1 is the S8 spike route. */
export const TIERS = [1, 58, 64, 72, 80, 96, 110] as const;
export const BOOKABLE_TIERS: readonly number[] = TIERS.filter((t) => t !== 1);
