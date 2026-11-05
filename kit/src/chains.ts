/**
 * Chain constants for Rialto.
 * Robinhood Chain: Arbitrum Orbit L2, chain id 4663, gas in ETH, stablecoin USDG (Paxos Global Dollar).
 * Venice AI settles x402 credit in USDC on Base (chain id 8453).
 */
import { base, robinhood } from "viem/chains";

export { base, robinhood };

export const ROBINHOOD_CHAIN_ID = 4663;
export const BASE_CHAIN_ID = 8453;

/** USDG (Global Dollar) on Robinhood Chain. 6 decimals. EIP-712 domain: name "Global Dollar", version "1". */
export const USDG_ADDRESS = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168" as const;
export const USDG_DECIMALS = 6;
export const USDG_EIP712 = { name: "Global Dollar", version: "1" } as const;

/** Native USDC on Base. 6 decimals. EIP-712 domain: name "USD Coin", version "2". */
export const BASE_USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
export const USDC_DECIMALS = 6;

/** Uniswap v3 on Robinhood Chain (used for on-chain price fallback). */
export const UNISWAP_V3_QUOTER_V2 = "0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7" as const;
export const UNISWAP_V3_FACTORY = "0x1f7d7550b1b028f7571e69a784071f0205fd2efa" as const;

export const ROBINHOOD_EXPLORER = "https://robinhoodchain.blockscout.com";
export const BASE_EXPLORER = "https://basescan.org";

export const VENICE_API = "https://api.venice.ai";
export const RELAY_API = "https://api.relay.link";
export const GECKOTERMINAL_API = "https://api.geckoterminal.com/api/v2";
export const GECKOTERMINAL_NETWORK = "robinhood";

export const RPC_ROBINHOOD = process.env.RIALTO_RPC_ROBINHOOD ?? "https://rpc.mainnet.chain.robinhood.com";
/** Public fallbacks, used after RPC_ROBINHOOD when it rate-limits or fails. */
export const RPC_ROBINHOOD_FALLBACKS = [
  "https://robinhood.drpc.org",
  "https://robinhood-rpc.publicnode.com",
  "https://robinhood.rpc.blxrbdn.com",
  "https://rpc.nodeflare.app/robinhood/public",
];
export const RPC_BASE = process.env.RIALTO_RPC_BASE ?? "https://mainnet.base.org";
