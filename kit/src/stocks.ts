/**
 * Tokenized stocks on Robinhood Chain ("<TICKER> • Robinhood Token", ERC-20, priced against USDG on Uniswap v3).
 * Discovery and prices come from the public GeckoTerminal API (no key). On-chain Uniswap v3 QuoterV2 is the fallback.
 */
import { erc20Abi, formatUnits, parseAbi, type Address } from "viem";
import { GECKOTERMINAL_API, GECKOTERMINAL_NETWORK, UNISWAP_V3_QUOTER_V2, USDG_ADDRESS, USDG_DECIMALS } from "./chains.js";
import { robinhoodClient } from "./wallet.js";

export type StockToken = { symbol: string; name: string; address: Address; decimals: number };

/** Seed registry (verified on chain on 2026-09-09). `rialto stocks find <ticker>` discovers the rest. */
export const STOCK_REGISTRY: StockToken[] = [
  { symbol: "AAPL", name: "Apple • Robinhood Token", address: "0xaf3d76f1834a1d425780943c99ea8a608f8a93f9", decimals: 18 },
  { symbol: "TSLA", name: "Tesla • Robinhood Token", address: "0x322f0929c4625ed5bad873c95208d54e1c003b2d", decimals: 18 },
  { symbol: "NVDA", name: "NVIDIA • Robinhood Token", address: "0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec", decimals: 18 },
];

const UA = { Accept: "application/json", "User-Agent": "rialto-kit/0.1" };

type GtPool = {
  attributes: { name: string; address: string; base_token_price_usd: string | null; reserve_in_usd: string | null; volume_usd?: { h24?: string } };
  relationships: { base_token: { data: { id: string } }; dex?: { data: { id: string } } };
};

async function gt<T>(path: string): Promise<T> {
  const res = await fetch(`${GECKOTERMINAL_API}${path}`, { headers: UA });
  if (res.status === 429) throw new Error("GeckoTerminal rate limit hit (30 requests/min). Retry in a few seconds.");
  if (!res.ok) throw new Error(`GeckoTerminal ${res.status} on ${path}`);
  return (await res.json()) as T;
}

export type StockQuote = {
  symbol: string;
  name: string;
  address: Address;
  priceUsd: number | null;
  poolAddress?: string;
  liquidityUsd?: number | null;
  volume24hUsd?: number | null;
  dex?: string;
  source: "geckoterminal" | "uniswap-v3-quoter";
};

/** Search GeckoTerminal for a ticker and keep only official "Robinhood Token" contracts. */
export async function findStock(ticker: string): Promise<StockQuote[]> {
  const q = ticker.trim().toUpperCase();
  const data = await gt<{ data: GtPool[]; included?: { id: string; attributes: { symbol: string; name: string; address: string; decimals?: number } }[] }>(
    `/search/pools?query=${encodeURIComponent(q)}&network=${GECKOTERMINAL_NETWORK}&include=base_token`,
  );
  const tokens = new Map((data.included ?? []).map((i) => [i.id, i.attributes]));
  const out: StockQuote[] = [];
  const seen = new Set<string>();
  for (const pool of data.data ?? []) {
    const t = tokens.get(pool.relationships.base_token.data.id);
    if (!t || !/Robinhood Token/i.test(t.name)) continue;
    if (seen.has(t.address.toLowerCase())) continue;
    seen.add(t.address.toLowerCase());
    const a = pool.attributes;
    out.push({
      symbol: t.symbol,
      name: t.name,
      address: t.address as Address,
      priceUsd: a.base_token_price_usd ? Number(a.base_token_price_usd) : null,
      poolAddress: a.address,
      liquidityUsd: a.reserve_in_usd ? Number(a.reserve_in_usd) : null,
      volume24hUsd: a.volume_usd?.h24 ? Number(a.volume_usd.h24) : null,
      dex: pool.relationships.dex?.data.id,
      source: "geckoterminal",
    });
  }
  return out;
}

/** Price a known stock token. Tries GeckoTerminal, then the Uniswap v3 quoter on chain. */
export async function stockPrice(symbolOrAddress: string): Promise<StockQuote> {
  const key = symbolOrAddress.trim();
  let token = STOCK_REGISTRY.find((t) => t.symbol === key.toUpperCase() || t.address.toLowerCase() === key.toLowerCase());
  if (!token) {
    const found = await findStock(key);
    if (found.length === 0) throw new Error(`No Robinhood stock token found for "${key}".`);
    return found[0];
  }
  try {
    const data = await gt<{ data: { attributes: { token_prices: Record<string, string> } } }>(
      `/simple/networks/${GECKOTERMINAL_NETWORK}/token_price/${token.address}`,
    );
    const price = data.data.attributes.token_prices[token.address.toLowerCase()];
    if (price) return { ...token, priceUsd: Number(price), source: "geckoterminal" };
  } catch {
    /* fall through to on-chain */
  }
  return quoteOnChain(token);
}

const quoterAbi = parseAbi([
  "function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut,uint160 sqrtPriceX96After,uint32 initializedTicksCrossed,uint256 gasEstimate)",
]);

/** Ask Uniswap v3 QuoterV2 what one whole token is worth in USDG. Tries the common fee tiers. */
export async function quoteOnChain(token: StockToken): Promise<StockQuote> {
  const client = robinhoodClient();
  const decimals = token.decimals ?? (await client.readContract({ address: token.address, abi: erc20Abi, functionName: "decimals" }));
  const amountIn = 10n ** BigInt(decimals);
  for (const fee of [500, 3000, 10000, 100]) {
    try {
      const { result } = await client.simulateContract({
        address: UNISWAP_V3_QUOTER_V2,
        abi: quoterAbi,
        functionName: "quoteExactInputSingle",
        args: [{ tokenIn: token.address, tokenOut: USDG_ADDRESS, amountIn, fee, sqrtPriceLimitX96: 0n }],
      });
      return { ...token, priceUsd: Number(formatUnits(result[0], USDG_DECIMALS)), source: "uniswap-v3-quoter" };
    } catch {
      continue;
    }
  }
  return { ...token, priceUsd: null, source: "uniswap-v3-quoter" };
}

/** Top pools on Robinhood Chain by 24h volume (a quick market overview). */
export async function topPools(limit = 10): Promise<{ name: string; address: string; priceUsd: number | null; volume24hUsd: number | null; liquidityUsd: number | null; dex?: string }[]> {
  const data = await gt<{ data: GtPool[] }>(`/networks/${GECKOTERMINAL_NETWORK}/pools?page=1&sort=h24_volume_usd_desc`);
  return (data.data ?? []).slice(0, limit).map((p) => ({
    name: p.attributes.name,
    address: p.attributes.address,
    priceUsd: p.attributes.base_token_price_usd ? Number(p.attributes.base_token_price_usd) : null,
    volume24hUsd: p.attributes.volume_usd?.h24 ? Number(p.attributes.volume_usd.h24) : null,
    liquidityUsd: p.attributes.reserve_in_usd ? Number(p.attributes.reserve_in_usd) : null,
    dex: p.relationships.dex?.data.id,
  }));
}
