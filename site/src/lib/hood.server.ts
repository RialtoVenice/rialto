/**
 * Server-only Robinhood Chain reads over raw JSON-RPC (no wallet, no keys, no extra dependencies).
 * Mirrors the read-only tools of the rialto-kit CLI so the hosted MCP endpoint and REST API stay in sync.
 */
import { PRIMARY_ORIGIN as SITE_ORIGIN, TOKEN_CA } from "./site";
import { tierFor } from "./tiers";
import snapshot from "../data/rialto-snapshot.json";

export const ROBINHOOD_CHAIN_ID = 4663;
export const RPC_URL = "https://rpc.mainnet.chain.robinhood.com";
/** Public RPCs for Robinhood Chain, tried in order on rate limits or errors. */
export const RPC_URLS = [
  "https://rpc.mainnet.chain.robinhood.com",
  "https://robinhood.drpc.org",
  "https://robinhood-rpc.publicnode.com",
  "https://robinhood.rpc.blxrbdn.com",
  "https://rpc.nodeflare.app/robinhood/public",
];
export const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
export const EXPLORER = "https://robinhoodchain.blockscout.com";
export const GECKO = "https://api.geckoterminal.com/api/v2";

export const STOCK_REGISTRY = [
  { symbol: "AAPL", name: "Apple • Robinhood Token", address: "0xaf3d76f1834a1d425780943c99ea8a608f8a93f9", decimals: 18 },
  { symbol: "TSLA", name: "Tesla • Robinhood Token", address: "0x322f0929c4625ed5bad873c95208d54e1c003b2d", decimals: 18 },
  { symbol: "NVDA", name: "NVIDIA • Robinhood Token", address: "0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec", decimals: 18 },
] as const;

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
export function isAddress(v: unknown): v is string {
  return typeof v === "string" && ADDRESS_RE.test(v);
}

// Short-lived read cache (per isolate). Public chain data only; keyed by the exact call.
const RPC_CACHE = new Map<string, { at: number; value: unknown }>();
const RPC_CACHE_TTL_MS = 8_000;

async function rpc<T = string>(method: string, params: unknown[]): Promise<T> {
  const key = method + JSON.stringify(params);
  const hit = RPC_CACHE.get(key);
  if (hit && Date.now() - hit.at < RPC_CACHE_TTL_MS) return hit.value as T;
  const errors: string[] = [];
  const isScan = method === "eth_getLogs";
  for (const url of RPC_URLS) {
    const host = new URL(url).host;
    // Only the official node serves wide log scans; when it throttles, a short pause and a retry beat moving on
    // to nodes that will refuse the request outright.
    const attempts = isScan && url === RPC_URLS[0] ? 3 : 1;
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 600 * attempt));
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
          // Log scans over wide block ranges legitimately take longer than a balance read.
          signal: AbortSignal.timeout(isScan ? 20_000 : 6_000),
        });
        if (!res.ok) {
          // 429, 403, 5xx: this node will not serve us right now, the next one might.
          errors.push(`${host} ${res.status}`);
          if (res.status === 429 || res.status >= 500) continue;
          break;
        }
        const json = (await res.json()) as { result?: T; error?: { message: string; code?: number } };
        if (json.error) {
          // Deterministic failures (reverts, bad params) stop here; anything a different node might answer moves on.
          if (json.error.code === 3 || /revert|invalid address|not an evm/i.test(json.error.message)) throw new Error(json.error.message);
          errors.push(`${host}: ${json.error.message.slice(0, 80)}`);
          break;
        }
        if (RPC_CACHE.size > 500) RPC_CACHE.clear();
        RPC_CACHE.set(key, { at: Date.now(), value: json.result });
        return json.result as T;
      } catch (e) {
        const msg = (e as Error).message;
        if (/revert|invalid address|not an evm/i.test(msg)) throw e;
        errors.push(`${host}: ${msg.slice(0, 60)}`);
        continue;
      }
    }
  }
  throw new Error(`${method} failed on every RPC (${errors.join("; ") || "no RPC reachable"})`);
}

function pad32(hexNo0x: string): string {
  return hexNo0x.toLowerCase().padStart(64, "0");
}

function formatUnits(value: bigint, decimals: number): string {
  const neg = value < 0n;
  const v = neg ? -value : value;
  const s = v.toString().padStart(decimals + 1, "0");
  const int = s.slice(0, s.length - decimals);
  const frac = s.slice(s.length - decimals).replace(/0+$/, "");
  return `${neg ? "-" : ""}${int}${frac ? "." + frac : ""}`;
}

export async function erc20Call(token: string, selector: string, argAddress?: string): Promise<bigint> {
  const data = selector + (argAddress ? pad32(argAddress.slice(2)) : "");
  const out = await rpc<string>("eth_call", [{ to: token, data }, "latest"]);
  return out && out !== "0x" ? BigInt(out) : 0n;
}

// One ERC-20 transfer on Robinhood Chain (measured on the Rialto burns): the reference for "what does a tx cost".
const TRANSFER_GAS = 29_296;
const VITALS_SAMPLE_BLOCKS = 2_000;

export type ChainVitals = { blocksPerSecond: number; avgBlockMs: number; sampledBlocks: number; transferFeeEth: number; transferFeeUsd: number | null; ethPriceUsd: number | null };

/** Cadence and cost, measured: blocks per second over the last 2,000 blocks, and the fee of one token transfer at the current gas price. */
export async function chainVitals(): Promise<ChainVitals> {
  const [headHex, gasHex, ethUsd] = await Promise.all([rpc<string>("eth_blockNumber", []), rpc<string>("eth_gasPrice", []), ethPriceUsd()]);
  const head = Number(headHex);
  const [a, b] = await Promise.all([
    rpc<{ timestamp: string }>("eth_getBlockByNumber", ["0x" + (head - VITALS_SAMPLE_BLOCKS).toString(16), false]),
    rpc<{ timestamp: string }>("eth_getBlockByNumber", [headHex, false]),
  ]);
  const seconds = Math.max(1, Number(BigInt(b.timestamp)) - Number(BigInt(a.timestamp)));
  const feeEth = (TRANSFER_GAS * Number(BigInt(gasHex))) / 1e18;
  return {
    blocksPerSecond: Math.round((VITALS_SAMPLE_BLOCKS / seconds) * 100) / 100,
    avgBlockMs: Math.round((seconds * 1000) / VITALS_SAMPLE_BLOCKS),
    sampledBlocks: VITALS_SAMPLE_BLOCKS,
    transferFeeEth: Number(feeEth.toFixed(9)),
    transferFeeUsd: ethUsd === null ? null : Number((feeEth * ethUsd).toFixed(6)),
    ethPriceUsd: ethUsd,
  };
}

export async function chainStatus() {
  const [chainIdHex, blockHex, gasHex, supply, vitals] = await Promise.all([
    rpc<string>("eth_chainId", []),
    rpc<string>("eth_blockNumber", []),
    rpc<string>("eth_gasPrice", []),
    erc20Call(USDG, "0x18160ddd"),
    chainVitals().catch(() => null),
  ]);
  return {
    chainId: Number(chainIdHex),
    blockNumber: Number(blockHex),
    gasPriceGwei: formatUnits(BigInt(gasHex), 9),
    usdgTotalSupply: formatUnits(supply, 6),
    vitals,
    explorer: EXPLORER,
    rpc: RPC_URL,
  };
}

export async function balances(address: string) {
  if (!isAddress(address)) throw new Error("Not an EVM address");
  const [ethHex, usdg] = await Promise.all([rpc<string>("eth_getBalance", [address, "latest"]), erc20Call(USDG, "0x70a08231", address)]);
  return { address, eth: formatUnits(BigInt(ethHex), 18), usdg: formatUnits(usdg, 6) };
}

export async function walletReport(address: string) {
  if (!isAddress(address)) throw new Error("Not an EVM address");
  const [bal, nonceHex, code, stocks, rialto] = await Promise.all([
    balances(address),
    rpc<string>("eth_getTransactionCount", [address, "latest"]),
    rpc<string>("eth_getCode", [address, "latest"]),
    Promise.all(
      STOCK_REGISTRY.map(async (t) => {
        try {
          const raw = await erc20Call(t.address, "0x70a08231", address);
          return { symbol: t.symbol, name: t.name, address: t.address, balance: formatUnits(raw, t.decimals) };
        } catch {
          return { symbol: t.symbol, name: t.name, address: t.address, balance: "0" };
        }
      }),
    ),
    rialtoBalance(address).then((r) => r.balance).catch(() => "0"),
  ]);
  return {
    ...bal,
    rialto,
    txCount: Number(nonceHex),
    isContract: !!code && code !== "0x",
    stockTokens: stocks.filter((s) => s.balance !== "0"),
    explorerUrl: `${EXPLORER}/address/${address}`,
  };
}

type GtPool = {
  attributes: { name: string; address: string; base_token_price_usd: string | null; reserve_in_usd: string | null; volume_usd?: { h24?: string } };
  relationships: { base_token: { data: { id: string } }; dex?: { data: { id: string } } };
};

// GeckoTerminal allows 30 requests per minute per IP and every visitor shares this server's IP: cache each path for 20 s
// and serve the last good answer for up to 2 minutes when the limit is hit.
const GECKO_CACHE = new Map<string, { at: number; value: unknown }>();
const GECKO_TTL_MS = 20_000;
const GECKO_STALE_MS = 120_000;
async function gecko<T>(path: string): Promise<T> {
  const hit = GECKO_CACHE.get(path);
  if (hit && Date.now() - hit.at < GECKO_TTL_MS) return hit.value as T;
  const res = await fetch(`${GECKO}${path}`, { headers: { accept: "application/json", "user-agent": "rialto-site/0.2" }, signal: AbortSignal.timeout(8_000) });
  if (res.status === 429) {
    if (hit && Date.now() - hit.at < GECKO_STALE_MS) return hit.value as T;
    throw new Error("GeckoTerminal rate limit (30 requests per minute). Retry shortly.");
  }
  if (!res.ok) throw new Error(`GeckoTerminal ${res.status}`);
  const value = (await res.json()) as T;
  if (GECKO_CACHE.size > 300) GECKO_CACHE.clear();
  GECKO_CACHE.set(path, { at: Date.now(), value });
  return value;
}

export async function stockFind(ticker: string) {
  const q = ticker.trim().toUpperCase().slice(0, 12);
  if (!/^[A-Z0-9.]+$/.test(q)) throw new Error("Ticker must be letters and digits");
  const data = await gecko<{ data: GtPool[]; included?: { id: string; attributes: { symbol: string; name: string; address: string } }[] }>(
    `/search/pools?query=${encodeURIComponent(q)}&network=robinhood&include=base_token`,
  );
  const tokens = new Map((data.included ?? []).map((i) => [i.id, i.attributes]));
  const seen = new Set<string>();
  const out: { symbol: string; name: string; address: string; priceUsd: number | null; poolAddress: string; liquidityUsd: number | null; volume24hUsd: number | null; dex?: string }[] = [];
  for (const pool of data.data ?? []) {
    const t = tokens.get(pool.relationships.base_token.data.id);
    if (!t || !/Robinhood Token/i.test(t.name) || seen.has(t.address.toLowerCase())) continue;
    seen.add(t.address.toLowerCase());
    const a = pool.attributes;
    out.push({
      symbol: t.symbol,
      name: t.name,
      address: t.address,
      priceUsd: a.base_token_price_usd ? Number(a.base_token_price_usd) : null,
      poolAddress: a.address,
      liquidityUsd: a.reserve_in_usd ? Number(a.reserve_in_usd) : null,
      volume24hUsd: a.volume_usd?.h24 ? Number(a.volume_usd.h24) : null,
      dex: pool.relationships.dex?.data.id,
    });
  }
  return out;
}

export async function stockPrice(symbol: string) {
  const key = symbol.trim();
  const known = STOCK_REGISTRY.find((t) => t.symbol === key.toUpperCase() || t.address.toLowerCase() === key.toLowerCase());
  if (!known) {
    const found = await stockFind(key);
    if (!found.length) throw new Error(`No Robinhood stock token found for "${key}"`);
    return found[0];
  }
  const data = await gecko<{ data: { attributes: { token_prices: Record<string, string> } } }>(`/simple/networks/robinhood/token_price/${known.address}`);
  const price = data.data.attributes.token_prices[known.address.toLowerCase()];
  return { symbol: known.symbol, name: known.name, address: known.address, priceUsd: price ? Number(price) : null };
}

export async function topPools(limit = 10) {
  const data = await gecko<{ data: GtPool[] }>(`/networks/robinhood/pools?page=1&sort=h24_volume_usd_desc`);
  return (data.data ?? []).slice(0, Math.max(1, Math.min(50, limit))).map((p) => ({
    name: p.attributes.name,
    address: p.attributes.address,
    priceUsd: p.attributes.base_token_price_usd ? Number(p.attributes.base_token_price_usd) : null,
    volume24hUsd: p.attributes.volume_usd?.h24 ? Number(p.attributes.volume_usd.h24) : null,
    liquidityUsd: p.attributes.reserve_in_usd ? Number(p.attributes.reserve_in_usd) : null,
    dex: p.relationships.dex?.data.id,
  }));
}

/** Batch prices for the seed registry in one GeckoTerminal call. */
export async function registryPrices(): Promise<{ symbol: string; name: string; address: string; priceUsd: number | null }[]> {
  const addrs = STOCK_REGISTRY.map((t) => t.address).join(",");
  const data = await gecko<{ data: { attributes: { token_prices: Record<string, string> } } }>(`/simple/networks/robinhood/token_price/${addrs}`);
  const prices = data.data.attributes.token_prices;
  return STOCK_REGISTRY.map((t) => ({ symbol: t.symbol, name: t.name, address: t.address, priceUsd: prices[t.address.toLowerCase()] ? Number(prices[t.address.toLowerCase()]) : null }));
}

/** Live stats for the Rialto token from GeckoTerminal (price, FDV, liquidity, 24h volume, main pool). */
export async function tokenStats(address: string) {
  const a = address.toLowerCase();
  const [tok, pools] = await Promise.all([
    gecko<{ data: { attributes: { name: string; symbol: string; price_usd: string | null; fdv_usd: string | null; total_reserve_in_usd: string | null; volume_usd?: { h24?: string } } } }>(`/networks/robinhood/tokens/${a}`),
    gecko<{ data: GtPool[] }>(`/networks/robinhood/tokens/${a}/pools?page=1`).catch(() => ({ data: [] as GtPool[] })),
  ]);
  const t = tok.data.attributes;
  const top = pools.data?.[0];
  return {
    name: t.name,
    symbol: t.symbol,
    priceUsd: t.price_usd ? Number(t.price_usd) : null,
    fdvUsd: t.fdv_usd ? Number(t.fdv_usd) : null,
    liquidityUsd: t.total_reserve_in_usd ? Number(t.total_reserve_in_usd) : top?.attributes.reserve_in_usd ? Number(top.attributes.reserve_in_usd) : null,
    volume24hUsd: t.volume_usd?.h24 ? Number(t.volume_usd.h24) : top?.attributes.volume_usd?.h24 ? Number(top.attributes.volume_usd.h24) : null,
    pool: top ? { name: top.attributes.name, address: top.attributes.address, dex: top.relationships.dex?.data.id } : null,
  };
}

/** Token supply figures read from the contract: total, burned (balance of the dead address), circulating. */
export async function tokenSupply(address: string, dead = "0x000000000000000000000000000000000000dEaD") {
  const [total, burned, decHex] = await Promise.all([
    erc20Call(address, "0x18160ddd"),
    erc20Call(address, "0x70a08231", dead),
    rpc<string>("eth_call", [{ to: address, data: "0x313ce567" }, "latest"]),
  ]);
  const decimals = Number(BigInt(decHex));
  return {
    decimals,
    total: formatUnits(total, decimals),
    burned: formatUnits(burned, decimals),
    circulating: formatUnits(total - burned, decimals),
    burnedPct: total > 0n ? Math.round(Number((burned * 1000000n) / total) / 100) / 100 : 0,
  };
}

let RIALTO_DECIMALS: number | null = null;
/** Rialto token balance of an address, in whole tokens (string). */
export async function rialtoBalance(address: string): Promise<{ address: string; balance: string; token: string }> {
  if (!isAddress(address)) throw new Error("Not an EVM address");
  if (RIALTO_DECIMALS === null) RIALTO_DECIMALS = Number(BigInt(await rpc<string>("eth_call", [{ to: TOKEN_CA, data: "0x313ce567" }, "latest"])));
  const raw = await erc20Call(TOKEN_CA, "0x70a08231", address);
  return { address, balance: formatUnits(raw, RIALTO_DECIMALS), token: TOKEN_CA };
}

async function ethPriceUsd(): Promise<number | null> {
  try {
    const res = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd", { headers: { accept: "application/json" }, signal: AbortSignal.timeout(5_000) });
    if (!res.ok) return null;
    const j = (await res.json()) as { ethereum?: { usd?: number } };
    return j.ethereum?.usd ?? null;
  } catch {
    return null;
  }
}

/** Holder tier: every asset the kit knows about, priced in USD. ETH, USDG, stock tokens, Rialto. */
export async function portfolio(address: string) {
  if (!isAddress(address)) throw new Error("Not an EVM address");
  const [report, prices, rialto, eth] = await Promise.all([
    walletReport(address),
    registryPrices().catch(() => null),
    tokenStats(TOKEN_CA).catch(() => null),
    ethPriceUsd(),
  ]);
  const price = (sym: string) => prices?.find((p) => p.symbol === sym)?.priceUsd ?? null;
  const row = (asset: string, balance: string, priceUsd: number | null, address?: string) => {
    const b = Number(balance);
    return { asset, balance, priceUsd, valueUsd: priceUsd === null ? null : Math.round(b * priceUsd * 100) / 100, ...(address ? { address } : {}) };
  };
  const positions = [
    row("ETH", report.eth, eth),
    row("USDG", report.usdg, 1, USDG),
    ...report.stockTokens.map((s) => row(s.symbol, s.balance, price(s.symbol), s.address)),
    row("RIALTO", report.rialto, rialto?.priceUsd ?? null, TOKEN_CA),
  ];
  const priced = positions.filter((p) => p.valueUsd !== null);
  return {
    address,
    positions,
    totalUsd: Math.round(priced.reduce((a, p) => a + (p.valueUsd ?? 0), 0) * 100) / 100,
    unpriced: positions.filter((p) => p.valueUsd === null && Number(p.balance) > 0).map((p) => p.asset),
    txCount: report.txCount,
    isContract: report.isContract,
    explorerUrl: report.explorerUrl,
  };
}

// ---------------------------------------------------------------------------------------------
// Live feeds: USDG transfers straight from the chain, trades from GeckoTerminal.
// ---------------------------------------------------------------------------------------------
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

export type UsdgTransfer = { from: string; to: string; amount: string; amountNum: number; block: number; tx: string; explorerUrl: string };

/** USDG Transfer events over the last `blocks` blocks (chain is busy: 120 blocks is a few hundred transfers). */
export async function usdgTransfers(blocks = 120, limit = 40) {
  const head = Number(BigInt(await rpc<string>("eth_blockNumber", [])));
  const span = Math.min(Math.max(10, blocks), 400);
  const from = head - span;
  const logs = await rpc<{ topics: string[]; data: string; blockNumber: string; transactionHash: string }[]>("eth_getLogs", [
    { fromBlock: "0x" + from.toString(16), toBlock: "0x" + head.toString(16), address: USDG, topics: [TRANSFER_TOPIC] },
  ]);
  const all: UsdgTransfer[] = logs.map((l) => {
    const raw = BigInt(l.data === "0x" ? "0x0" : l.data);
    return {
      from: "0x" + l.topics[1].slice(26),
      to: "0x" + l.topics[2].slice(26),
      amount: formatUnits(raw, 6),
      amountNum: Number(raw) / 1e6,
      block: Number(BigInt(l.blockNumber)),
      tx: l.transactionHash,
      explorerUrl: `${EXPLORER}/tx/${l.transactionHash}`,
    };
  });
  const volume = all.reduce((a, t) => a + t.amountNum, 0);
  const largest = [...all].sort((a, b) => b.amountNum - a.amountNum).slice(0, limit);
  const latest = [...all].sort((a, b) => b.block - a.block).slice(0, limit);
  return { fromBlock: from, toBlock: head, blocks: span, count: all.length, volumeUsdg: Math.round(volume * 100) / 100, largest, latest };
}

export type Trade = { time: string; kind: "buy" | "sell"; usd: number; priceUsd: number; tokenAmount: number; trader: string; tx: string; explorerUrl: string };

type GtTrade = {
  attributes: {
    block_timestamp: string; kind: "buy" | "sell"; volume_in_usd: string; tx_hash: string; tx_from_address: string;
    from_token_amount: string; to_token_amount: string; from_token_address: string; to_token_address: string; price_from_in_usd: string; price_to_in_usd: string;
  };
};

/** Recent trades on a pool, normalised around `token` (the asset the reader cares about). */
export async function poolTrades(pool: string, token: string, limit = 40) {
  const data = await gecko<{ data: GtTrade[] }>(`/networks/robinhood/pools/${pool.toLowerCase()}/trades?trade_volume_in_usd_greater_than=0`);
  const t = token.toLowerCase();
  const trades: Trade[] = data.data.map(({ attributes: a }) => {
    const tokenIsTo = a.to_token_address.toLowerCase() === t;
    return {
      time: a.block_timestamp,
      kind: a.kind,
      usd: Number(a.volume_in_usd),
      priceUsd: Number(tokenIsTo ? a.price_to_in_usd : a.price_from_in_usd),
      tokenAmount: Number(tokenIsTo ? a.to_token_amount : a.from_token_amount),
      trader: a.tx_from_address,
      tx: a.tx_hash,
      explorerUrl: `${EXPLORER}/tx/${a.tx_hash}`,
    };
  });
  const hourAgo = Date.now() - 3600_000;
  const lastHour = trades.filter((x) => Date.parse(x.time) >= hourAgo);
  const sum = (xs: Trade[], k: "buy" | "sell") => Math.round(xs.filter((x) => x.kind === k).reduce((a, x) => a + x.usd, 0) * 100) / 100;
  return {
    pool,
    token,
    lastPriceUsd: trades[0]?.priceUsd ?? null,
    lastHour: { trades: lastHour.length, buys: lastHour.filter((x) => x.kind === "buy").length, sells: lastHour.filter((x) => x.kind === "sell").length, buyUsd: sum(lastHour, "buy"), sellUsd: sum(lastHour, "sell") },
    trades: trades.slice(0, limit),
  };
}

/** Known pools for the trade feeds. Stock tokens trade against USDG on Uniswap v3; Rialto trades against ETH on Uniswap v4. */
export const TRADE_POOLS: Record<string, { pool: string; token: string; label: string }> = {
  RIALTO: { pool: "0xf9aec85dd4eb9ec9148e0b4b50a3fd8e9886dcae6ecc979f9369b84b01037c0b", token: TOKEN_CA, label: "Rialto / ETH" },
  AAPL: { pool: "0xaae0d815ee56e4092a5e5c2911e676fea50b2d6d", token: "0xaf3d76f1834a1d425780943c99ea8a608f8a93f9", label: "AAPL / USDG" },
  TSLA: { pool: "0xf4acdaeeb7022862a763c9b1b885e11191c889e3", token: "0x322f0929c4625ed5bad873c95208d54e1c003b2d", label: "TSLA / USDG" },
  NVDA: { pool: "0xd4eb21209c4d6093f80b5b84f5c45cc093ea14a3", token: "0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec", label: "NVDA / USDG" },
};

/** Trades for a known symbol (RIALTO, AAPL, TSLA, NVDA) or any discovered stock ticker (pool found through GeckoTerminal). */
export async function recentTrades(symbolOrPool: string, limit = 40) {
  const key = symbolOrPool.toUpperCase();
  const known = TRADE_POOLS[key];
  if (known) return { symbol: key, label: known.label, ...(await poolTrades(known.pool, known.token, limit)) };
  if (/^0x[0-9a-fA-F]{40,64}$/.test(symbolOrPool)) {
    const d = await gecko<{ data: { attributes: { name: string; address: string }; relationships: { base_token: { data: { id: string } } } } }>(`/networks/robinhood/pools/${symbolOrPool.toLowerCase()}`);
    const base = d.data.relationships.base_token.data.id.split("_")[1];
    return { symbol: d.data.attributes.name, label: d.data.attributes.name, ...(await poolTrades(symbolOrPool, base, limit)) };
  }
  const found = await stockFind(key);
  const hit = found.find((f) => f.symbol.toUpperCase() === key && f.poolAddress);
  if (!hit?.poolAddress) throw new Error(`No pool found for ${symbolOrPool}. Try RIALTO, AAPL, TSLA, NVDA, a ticker, or a pool address.`);
  return { symbol: hit.symbol, label: hit.name, ...(await poolTrades(hit.poolAddress, hit.address, limit)) };
}

/** One-shot summary for the live page: chain, latest block, USDG flow, Rialto tape. */
export async function pulse() {
  const [chain, blockRaw, transfers, rialto] = await Promise.all([
    chainStatus(),
    rpc<{ number: string; timestamp: string; transactions: string[]; gasUsed: string }>("eth_getBlockByNumber", ["latest", false]),
    usdgTransfers(120, 12).catch(() => null),
    recentTrades("RIALTO", 12).catch(() => null),
  ]);
  return {
    chain,
    latestBlock: { number: Number(BigInt(blockRaw.number)), timestamp: Number(BigInt(blockRaw.timestamp)), txCount: blockRaw.transactions.length, gasUsed: Number(BigInt(blockRaw.gasUsed)) },
    usdg: transfers ? { blocks: transfers.blocks, transfers: transfers.count, volumeUsdg: transfers.volumeUsdg, largest: transfers.largest.slice(0, 5), latest: transfers.latest.slice(0, 8) } : null,
    rialto: rialto ? { lastPriceUsd: rialto.lastPriceUsd, lastHour: rialto.lastHour, trades: rialto.trades.slice(0, 8) } : null,
    fetchedAt: new Date().toISOString(),
  };
}


// ---------------------------------------------------------------------------------------------
// Rialto token ledger: burns, holders and price history, all from the chain and GeckoTerminal.
// ---------------------------------------------------------------------------------------------
const DEAD = "0x000000000000000000000000000000000000dEaD";
const ZERO32 = "0x" + "0".repeat(64);
const topicAddr = (a: string) => "0x" + a.slice(2).toLowerCase().padStart(64, "0");

type Log = { address?: string; topics: string[]; data: string; blockNumber: string; transactionHash: string };

const LEDGER_CACHE = new Map<string, { at: number; value: unknown }>();
async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = LEDGER_CACHE.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as T;
  const value = await fn();
  LEDGER_CACHE.set(key, { at: Date.now(), value });
  return value;
}

async function blockTimestamp(block: number): Promise<number> {
  const b = await rpc<{ timestamp: string }>("eth_getBlockByNumber", ["0x" + block.toString(16), false]);
  return Number(BigInt(b.timestamp));
}

export type Burn = { block: number; timestamp: number | null; from: string; amount: string; amountNum: number; tx: string; explorerUrl: string };
export type BurnLedger = { token: string; deadAddress: string; count: number; burnedTotal: number; burnedPct: number; burns: Burn[] };
export type HolderRow = { address: string; balance: number; sharePct: number; label: string | null; isContract: boolean; explorerUrl: string };
export type HolderStats = { token: string; holders: number; transfers: number; asOfBlock: number; top10SharePct: number; top: HolderRow[]; fetchedAt: string };
export type Candle = { t: number; o: number; h: number; l: number; c: number; v: number };
export type Ohlcv = { pool: string; hours: number; candles: Candle[]; first: number | null; last: number | null; changePct: number | null; volumeUsd: number };

/** Every burn of the Rialto token: Transfer events to the dead address since the contract was created. */
export async function tokenBurns(): Promise<BurnLedger> {
  return cached<BurnLedger>("burns", 60_000, async () => {
    const logs = await rpc<Log[]>("eth_getLogs", [{ fromBlock: "0x0", toBlock: "latest", address: TOKEN_CA, topics: [TRANSFER_TOPIC, null, topicAddr(DEAD)] }]);
    const total = await erc20Call(TOKEN_CA, "0x18160ddd");
    const burns: Burn[] = await Promise.all(
      logs.map(async (l) => {
        const block = Number(BigInt(l.blockNumber));
        const raw = BigInt(l.data);
        return { block, timestamp: await blockTimestamp(block).catch(() => null), from: "0x" + l.topics[1].slice(26), amount: formatUnits(raw, 18), amountNum: Number(raw) / 1e18, tx: l.transactionHash, explorerUrl: `${EXPLORER}/tx/${l.transactionHash}` };
      }),
    );
    burns.sort((a, b) => b.block - a.block);
    const burned = burns.reduce((a, b) => a + b.amountNum, 0);
    // Dust sent to the dead address by third parties still counts in the total but does not clutter the list.
    const listed = burns.filter((b) => b.amountNum >= 1);
    return { token: TOKEN_CA, deadAddress: DEAD, count: listed.length, burnedTotal: Math.round(burned), burnedPct: Math.round((burned / (Number(total) / 1e18)) * 10000) / 100, burns: listed };
  });
}

/**
 * The Rialto ledger: balances replayed from every Transfer, seeded from the snapshot written at build time
 * (scripts/snapshot.mjs) and extended at runtime with only the blocks mined since. The public RPC throttles wide
 * log scans from shared hosting addresses, so the runtime never asks for more than the delta, and if even that is
 * refused the snapshot state is served with its block clearly stated. Concurrent callers share one delta scan.
 */
const RIALTO_LEDGER: { toBlock: number; bal: Map<string, bigint>; transfers: number; inflight: Promise<void> | null } = {
  toBlock: snapshot.block,
  bal: new Map(Object.entries(snapshot.balances as Record<string, string>).map(([a, v]) => [a, BigInt(v)])),
  transfers: snapshot.transfers,
  inflight: null,
};

/** Per-wallet aggregates in order of first appearance: the position in the map is the wallet's number since launch. */
type WalletAgg = { first: number; last: number; received: number; sent: number; transfers: number; burned: number };
const WALLETS = new Map<string, WalletAgg>(
  Object.entries((snapshot as { wallets?: Record<string, number[]> }).wallets ?? {}).map(([a, w]) => [a, { first: w[0], last: w[1], received: w[2], sent: w[3], transfers: w[4], burned: w[5] }]),
);

function touchWallet(a: string, block: number, received: number, sent: number, burned: number) {
  const w = WALLETS.get(a);
  if (w) {
    w.last = Math.max(w.last, block);
    w.received += received;
    w.sent += sent;
    w.burned += burned;
    w.transfers++;
  } else WALLETS.set(a, { first: block, last: block, received, sent, transfers: 1, burned });
}

function applyTransfers(bal: Map<string, bigint>, logs: Log[]) {
  for (const l of logs) {
    const from = "0x" + l.topics[1].slice(26);
    const to = "0x" + l.topics[2].slice(26);
    const v = BigInt(l.data === "0x" ? "0x0" : l.data);
    const block = Number(BigInt(l.blockNumber));
    const whole = Number(v) / 1e18;
    if (l.topics[1] !== ZERO32) {
      bal.set(from, (bal.get(from) ?? 0n) - v);
      touchWallet(from, block, 0, whole, to === DEAD.toLowerCase() ? whole : 0);
    }
    bal.set(to, (bal.get(to) ?? 0n) + v);
    touchWallet(to, block, whole, 0, 0);
  }
}

/** Balances of every Rialto holder as of the latest block the RPC let us reach, plus the transfer count. */
export async function rialtoLedger(): Promise<{ bal: Map<string, bigint>; transfers: number; asOfBlock: number; delta: number; snapshotBlock: number }> {
  if (!RIALTO_LEDGER.inflight) {
    RIALTO_LEDGER.inflight = (async () => {
      try {
        const fresh = await scanTransfers(TOKEN_CA, RIALTO_LEDGER.toBlock + 1, Infinity);
        // A lagging node can report a head below what was already applied; never move backwards or re-apply logs.
        if (fresh.head > RIALTO_LEDGER.toBlock) {
          applyTransfers(RIALTO_LEDGER.bal, fresh.logs);
          RIALTO_LEDGER.transfers += fresh.logs.length;
          RIALTO_LEDGER.toBlock = fresh.head;
        }
      } catch {
        // The delta could not be fetched right now; the state from the last successful scan stands.
      } finally {
        RIALTO_LEDGER.inflight = null;
      }
    })();
  }
  await RIALTO_LEDGER.inflight;
  return { bal: RIALTO_LEDGER.bal, transfers: RIALTO_LEDGER.transfers, asOfBlock: RIALTO_LEDGER.toBlock, delta: RIALTO_LEDGER.toBlock - snapshot.block, snapshotBlock: snapshot.block };
}

/** Scan every Transfer of a token in block chunks that respect the 10k-logs limit of the public RPC. Stops past `cap` logs. */
async function allTokenTransfers(token: string, startBlock: number, cap = Infinity): Promise<Log[]> {
  return (await scanTransfers(token, startBlock, cap)).logs;
}

async function scanTransfers(token: string, startBlock: number, cap: number): Promise<{ logs: Log[]; head: number }> {
  const head = Number(BigInt(await rpc<string>("eth_blockNumber", [])));
  const out: Log[] = [];
  if (startBlock > head) return { logs: out, head };
  const scan = async (from: number, to: number): Promise<void> => {
    if (out.length > cap) return;
    try {
      const logs = await rpc<Log[]>("eth_getLogs", [{ fromBlock: "0x" + from.toString(16), toBlock: "0x" + to.toString(16), address: token, topics: [TRANSFER_TOPIC] }]);
      out.push(...logs);
    } catch (e) {
      // Any failure on a wide range (log limit, bad params on some nodes, timeouts): halve and retry.
      if (to - from > 2000) {
        const mid = Math.floor((from + to) / 2);
        await scan(from, mid);
        await scan(mid + 1, to);
      } else throw e;
    }
  };
  for (let from = startBlock; from <= head && out.length <= cap; from += 100_000) await scan(from, Math.min(from + 99_999, head));
  return { logs: out, head };
}

export type HistoryPoint = { day: string; block: number; holders: number; burned: number; transfers: number; walletsEver: number };
export type DistributionBucket = { label: string; min: number; wallets: number; tokens: number };
export type TokenHistory = { history: HistoryPoint[]; distribution: DistributionBucket[]; asOfBlock: number; holders: number; walletsEver: number };

const BUCKETS: { label: string; min: number }[] = [
  { label: "Pro, 1,000,000+", min: 1_000_000 },
  { label: "Holder, 300,000 to 1M", min: 300_000 },
  { label: "100,000 to 300,000", min: 100_000 },
  { label: "10,000 to 100,000", min: 10_000 },
  { label: "under 10,000", min: 0 },
];

/** Growth of the token, day by day, replayed from every transfer; plus who holds how much right now, by tier bucket. */
export async function tokenHistory(): Promise<TokenHistory> {
  const ledger = await rialtoLedger();
  const hist = (snapshot.history as HistoryPoint[]).map((h) => ({ ...h }));
  // The last point is "now" in the snapshot; refresh it from the live ledger so the curve ends at the current block.
  let holders = 0;
  let burned = 0n;
  const counts = BUCKETS.map(() => ({ wallets: 0, tokens: 0 }));
  for (const [a, v] of ledger.bal) {
    if (v <= 0n) continue;
    if (a === DEAD.toLowerCase()) {
      burned = v;
      continue;
    }
    holders++;
    const whole = Number(v) / 1e18;
    const i = BUCKETS.findIndex((b) => whole >= b.min);
    counts[i].wallets++;
    counts[i].tokens += whole;
  }
  if (hist.length) {
    const last = hist[hist.length - 1];
    hist[hist.length - 1] = { ...last, day: new Date().toISOString().slice(0, 10) + " (now)", block: ledger.asOfBlock, holders, burned: Math.round(Number(burned) / 1e18), transfers: ledger.transfers, walletsEver: Math.max(last.walletsEver, hist[hist.length - 1].walletsEver) };
  }
  return { history: hist, distribution: BUCKETS.map((b, i) => ({ label: b.label, min: b.min, wallets: counts[i].wallets, tokens: Math.round(counts[i].tokens) })), asOfBlock: ledger.asOfBlock, holders, walletsEver: hist.length ? hist[hist.length - 1].walletsEver : 0 };
}

// ---------------------------------------------------------------------------------------------
// Rank: where one wallet stands among every wallet that ever held Rialto, and the leaderboard.
// ---------------------------------------------------------------------------------------------
export type WalletRank = {
  address: string;
  balance: number;
  sharePct: number;
  /** Position among current holders by balance, 1 = largest. Null when the wallet holds nothing. */
  rank: number | null;
  holders: number;
  /** Top X% of holders by balance. */
  topPct: number | null;
  tier: "Free" | "Holder" | "Pro";
  nextTier: { name: "Holder" | "Pro"; need: number } | null;
  /** The Nth wallet ever to receive Rialto, counted from the first transfer. */
  walletNo: number | null;
  walletsEver: number;
  firstBlock: number | null;
  firstSeen: string | null;
  firstDay: string | null;
  daysHeld: number | null;
  lastBlock: number | null;
  received: number;
  sent: number;
  burned: number;
  transfers: number;
  /** Has held since the first day of trading (UTC). */
  dayOne: boolean;
  /** Holds Rialto and has never sent any out (burns excepted). */
  diamond: boolean;
  label: string | null;
  explorerUrl: string;
  badgeUrl: string;
  shareUrl: string;
  shareText: string;
  asOfBlock: number;
};

export type LeaderboardRow = { rank: number; address: string; balance: number; sharePct: number; firstDay: string | null; walletNo: number; diamond: boolean; dayOne: boolean; label: string | null; explorerUrl: string };
export type Leaderboard = {
  rows: LeaderboardRow[];
  holders: number;
  walletsEver: number;
  /** Wallets that hold Rialto and have never sent any out. */
  diamondHands: number;
  /** Wallets from the first day of trading that still hold. */
  dayOneStillHolding: number;
  dayOneWallets: number;
  /** Wallets that once held and hold nothing now. */
  exited: number;
  medianBalance: number;
  asOfBlock: number;
  fetchedAt: string;
};

/** The block that closed the first day of trading (UTC): every wallet first seen at or before it is "day one". */
const DAY_ONE_BLOCK: number = (snapshot.history as { block: number }[])[0]?.block ?? 0;

/** UTC day of a block, from the day boundaries the snapshot found; the current day for anything past them. */
function dayOfBlock(block: number): string | null {
  const points = snapshot.history as { day: string; block: number }[];
  if (!points.length) return null;
  for (const p of points) {
    if (block <= p.block) {
      if (p.day.endsWith("(now)")) return p.day.slice(0, 10);
      const d = new Date(p.day + "T00:00:00Z");
      d.setUTCDate(d.getUTCDate() - 1);
      return d.toISOString().slice(0, 10);
    }
  }
  return new Date().toISOString().slice(0, 10);
}

function walletLabel(a: string): string | null {
  return a === DEAD.toLowerCase() ? "burned (dead address)" : a === "0x987e58bed5028b28cfe5e8c709b8533d6f908ebe" ? "deployer" : null;
}

/** Whether an address is a contract (pool, vault, router). Code never changes, so the answer is kept for the life of the instance. */
const CODE_CACHE = new Map<string, boolean>();
async function isContract(a: string): Promise<boolean> {
  const hit = CODE_CACHE.get(a);
  if (hit !== undefined) return hit;
  const code = await rpc<string>("eth_getCode", [a, "latest"]).catch(() => null);
  if (code === null) return false;
  const v = code !== "0x";
  CODE_CACHE.set(a, v);
  return v;
}

/** Holders sorted by balance, dead address excluded, plus the wallet numbers. Rebuilt at most once a minute. */
async function rankedHolders(): Promise<{ rows: { address: string; balance: number }[]; supply: number; walletNo: Map<string, number>; asOfBlock: number }> {
  return cached("ranked", 60_000, async () => {
    const ledger = await rialtoLedger();
    const supply = Number(await erc20Call(TOKEN_CA, "0x18160ddd")) / 1e18;
    const rows = [...ledger.bal.entries()]
      .filter(([a, v]) => v > 0n && a !== DEAD.toLowerCase())
      .map(([address, v]) => ({ address, balance: Number(v) / 1e18 }))
      .sort((a, b) => b.balance - a.balance);
    const walletNo = new Map<string, number>();
    let n = 0;
    for (const a of WALLETS.keys()) if (a !== DEAD.toLowerCase()) walletNo.set(a, ++n);
    return { rows, supply, walletNo, asOfBlock: ledger.asOfBlock };
  });
}

/** Where one wallet stands: rank, share, tier, wallet number since launch, first seen, days held, in and out, diamond hands. */
export async function walletRank(addressIn: string): Promise<WalletRank> {
  if (!isAddress(addressIn)) throw new Error("address must be a 0x EVM address");
  const address = addressIn.toLowerCase();
  const { rows, supply, walletNo, asOfBlock } = await rankedHolders();
  const idx = rows.findIndex((r) => r.address === address);
  const balance = idx >= 0 ? rows[idx].balance : 0;
  const agg = WALLETS.get(address) ?? null;
  const tier = tierFor(balance);
  const next = tier.name === "Pro" ? null : tier.name === "Holder" ? { name: "Pro" as const, need: Math.ceil(1_000_000 - balance) } : { name: "Holder" as const, need: Math.ceil(300_000 - balance) };
  const firstSeen = agg ? await blockTimestamp(agg.first).catch(() => null) : null;
  const firstDay = agg ? dayOfBlock(agg.first) : null;
  const daysHeld = firstSeen ? Math.floor((Date.now() / 1000 - firstSeen) / 86400) : firstDay ? Math.floor((Date.now() - new Date(firstDay + "T00:00:00Z").getTime()) / 86_400_000) : null;
  const diamond = balance > 0 && !!agg && agg.sent - agg.burned <= 0.000001;
  const dayOne = !!agg && agg.first <= DAY_ONE_BLOCK;
  const rank = idx >= 0 ? idx + 1 : null;
  const no = walletNo.get(address) ?? null;
  const pieces = [
    no ? `Wallet #${no.toLocaleString("en-US")} of ${walletNo.size.toLocaleString("en-US")} to ever hold Rialto on Robinhood Chain.` : `Not on the Rialto ledger yet.`,
    rank ? `Rank #${rank.toLocaleString("en-US")} of ${rows.length.toLocaleString("en-US")} holders.` : "",
    diamond ? "Never sold." : "",
    dayOne ? "Day one." : "",
  ].filter(Boolean);
  const shareText = `${pieces.join(" ")} Check yours: ${SITE_ORIGIN}/#tab-rank`;
  return {
    address,
    balance: Math.round(balance * 100) / 100,
    sharePct: Math.round((balance / supply) * 100000) / 1000,
    rank,
    holders: rows.length,
    topPct: rank ? Math.max(0.1, Math.round((rank / rows.length) * 1000) / 10) : null,
    tier: tier.name,
    nextTier: next,
    walletNo: no,
    walletsEver: walletNo.size,
    firstBlock: agg?.first ?? null,
    firstSeen: firstSeen ? new Date(firstSeen * 1000).toISOString() : null,
    firstDay,
    daysHeld,
    lastBlock: agg?.last ?? null,
    received: Math.round((agg?.received ?? 0) * 100) / 100,
    sent: Math.round((agg?.sent ?? 0) * 100) / 100,
    burned: Math.round((agg?.burned ?? 0) * 100) / 100,
    transfers: agg?.transfers ?? 0,
    dayOne,
    diamond,
    label: walletLabel(address) ?? ((await isContract(address)) ? "contract (pool or vault)" : null),
    explorerUrl: `${EXPLORER}/address/${address}`,
    badgeUrl: `${SITE_ORIGIN}/badge/${address}.svg`,
    shareUrl: `https://x.com/intent/post?text=${encodeURIComponent(shareText)}`,
    shareText,
    asOfBlock,
  };
}

/** Top holders with rank, first day and diamond-hands flag, plus cohort figures for the whole ledger. */
export async function leaderboard(limit = 25): Promise<Leaderboard> {
  const n = Math.min(Math.max(1, Math.floor(limit)), 100);
  const { rows, supply, walletNo, asOfBlock } = await rankedHolders();
  let diamondHands = 0;
  let dayOneStillHolding = 0;
  for (const r of rows) {
    const w = WALLETS.get(r.address);
    if (!w) continue;
    if (w.sent - w.burned <= 0.000001) diamondHands++;
    if (w.first <= DAY_ONE_BLOCK) dayOneStillHolding++;
  }
  let dayOneWallets = 0;
  for (const [a, w] of WALLETS) if (a !== DEAD.toLowerCase() && w.first <= DAY_ONE_BLOCK) dayOneWallets++;
  const balances = rows.map((r) => r.balance);
  const median = balances.length ? balances[Math.floor(balances.length / 2)] : 0;
  const out: LeaderboardRow[] = await Promise.all(rows.slice(0, n).map(async (r, i) => {
    const w = WALLETS.get(r.address);
    const contract = i < 30 ? await isContract(r.address) : false;
    return {
      rank: i + 1,
      address: r.address,
      balance: Math.round(r.balance),
      sharePct: Math.round((r.balance / supply) * 10000) / 100,
      firstDay: w ? dayOfBlock(w.first) : null,
      walletNo: walletNo.get(r.address) ?? 0,
      diamond: !contract && !!w && w.sent - w.burned <= 0.000001,
      dayOne: !!w && w.first <= DAY_ONE_BLOCK,
      label: walletLabel(r.address) ?? (contract ? "contract (pool or vault)" : null),
      explorerUrl: `${EXPLORER}/address/${r.address}`,
    };
  }));
  return { rows: out, holders: rows.length, walletsEver: walletNo.size, diamondHands, dayOneStillHolding, dayOneWallets, exited: Math.max(0, walletNo.size - rows.length), medianBalance: Math.round(median), asOfBlock, fetchedAt: new Date().toISOString() };
}

/** A shields-style SVG badge for a wallet: rank, balance, diamond hands. Safe to embed anywhere. */
export async function walletBadge(address: string): Promise<string> {
  const r = await walletRank(address);
  const k = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M` : n >= 1_000 ? `${Math.round(n / 1_000)}K` : String(Math.round(n)));
  const right = r.rank ? `#${r.rank} of ${r.holders} · ${k(r.balance)} Rialto${r.diamond ? " · never sold" : ""}${r.dayOne ? " · day one" : ""}` : "not a holder";
  const left = "Rialto";
  const lw = Math.round(left.length * 7 + 14);
  const rw = Math.round(right.length * 6.4 + 14);
  const w = lw + rw;
  const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="20" role="img" aria-label="${esc(left)}: ${esc(right)}"><title>${esc(left)}: ${esc(right)}</title><linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#fff" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient><clipPath id="r"><rect width="${w}" height="20" rx="4" fill="#fff"/></clipPath><g clip-path="url(#r)"><rect width="${lw}" height="20" fill="#c45c3e"/><rect x="${lw}" width="${rw}" height="20" fill="${r.diamond ? "#1f6f5a" : "#2b2523"}"/><rect width="${w}" height="20" fill="url(#s)"/></g><g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11"><text x="${lw / 2}" y="14" fill="#010101" fill-opacity=".3">${esc(left)}</text><text x="${lw / 2}" y="13" font-weight="bold">${esc(left)}</text><text x="${lw + rw / 2}" y="14" fill="#010101" fill-opacity=".3">${esc(right)}</text><text x="${lw + rw / 2}" y="13">${esc(right)}</text></g></svg>`;
}

export type TokenVolume = { sinceLaunchUsd: number; pools: number; poolsCounted: number; partial: boolean; since: string; snapshotAt: string; fetchedAt: string };

// Daily volume per pool is stable once the day is over, so each pool's sum is kept for 15 minutes and, when
// GeckoTerminal refuses a refresh, the last known figure is reused rather than dropped from the total. A single call
// fetches at most a few uncached pools so the shared 30-per-minute budget is never spent in one burst; the picture
// completes over the next calls and the response says how many pools it covers.
const VOLUME_CACHE = new Map<string, { at: number; usd: number; failedAt?: number }>(
  Object.entries(snapshot.volumes as Record<string, number>).map(([pool, usd]) => [pool, { at: 1, usd }]),
);
const VOLUME_TTL_MS = 15 * 60_000;
const VOLUME_RETRY_MS = 60_000;
const VOLUME_FETCHES_PER_CALL = 4;

/** Volume traded since launch, in USD, summed over every pool that lists the Rialto token (GeckoTerminal daily candles). */
export async function tokenVolume(address: string = TOKEN_CA): Promise<TokenVolume> {
  const a = address.toLowerCase();
  const pools = await gecko<{ data: GtPool[] }>(`/networks/robinhood/tokens/${a}/pools?page=1`);
  let total = 0;
  let counted = 0;
  let fetches = 0;
  for (const p of pools.data) {
    const addr = p.attributes.address.toLowerCase();
    const hit = VOLUME_CACHE.get(addr);
    const fresh = hit && Date.now() - hit.at < VOLUME_TTL_MS;
    const cooling = hit?.failedAt && Date.now() - hit.failedAt < VOLUME_RETRY_MS;
    if (fresh || cooling || fetches >= VOLUME_FETCHES_PER_CALL) {
      if (hit && hit.at > 0) {
        total += hit.usd;
        counted++;
      }
      continue;
    }
    fetches++;
    try {
      const d = await gecko<{ data: { attributes: { ohlcv_list: [number, number, number, number, number, number][] } } }>(`/networks/robinhood/pools/${addr}/ohlcv/day?limit=60&currency=usd`);
      const usd = d.data.attributes.ohlcv_list.reduce((s, c) => s + (Number(c[5]) || 0), 0);
      VOLUME_CACHE.set(addr, { at: Date.now(), usd });
      total += usd;
      counted++;
    } catch {
      VOLUME_CACHE.set(addr, { at: hit?.at ?? 0, usd: hit?.usd ?? 0, failedAt: Date.now() });
      if (hit && hit.at > 0) {
        total += hit.usd;
        counted++;
      }
    }
  }
  return { sinceLaunchUsd: Math.round(total), pools: pools.data.length, poolsCounted: counted, partial: counted < pools.data.length, since: "2026-09-10", snapshotAt: snapshot.generatedAt, fetchedAt: new Date().toISOString() };
}

/** Holder statistics from the full transfer history: count, top holders, concentration. Cached for a minute. */
export async function tokenHolders(top = 10): Promise<HolderStats> {
  return cached<HolderStats>("holders", 120_000, async () => {
    const ledger = await rialtoLedger();
    const bal = ledger.bal;
    const total = Number(await erc20Call(TOKEN_CA, "0x18160ddd")) / 1e18;
    const rows = [...bal.entries()].filter(([, v]) => v > 0n).map(([address, v]) => ({ address, balance: Number(v) / 1e18 })).sort((a, b) => b.balance - a.balance);
    const label = (a: string) => (a.toLowerCase() === DEAD.toLowerCase() ? "burned (dead address)" : a.toLowerCase() === "0x987e58bed5028b28cfe5e8c709b8533d6f908ebe" ? "deployer" : null);
    const topRows: HolderRow[] = await Promise.all(
      rows.slice(0, top).map(async (r) => {
        const code = await rpc<string>("eth_getCode", [r.address, "latest"]).catch(() => "0x");
        const isContract = !!code && code !== "0x";
        return { ...r, balance: Math.round(r.balance), sharePct: Math.round((r.balance / total) * 10000) / 100, label: label(r.address) ?? (isContract ? "contract (pool or vault)" : null), isContract, explorerUrl: `${EXPLORER}/address/${r.address}` };
      }),
    );
    const live = rows.filter((r) => r.address.toLowerCase() !== DEAD.toLowerCase());
    const top10 = live.slice(0, 10).reduce((a, r) => a + r.balance, 0);
    return { token: TOKEN_CA, holders: live.length, transfers: ledger.transfers, asOfBlock: ledger.asOfBlock, top10SharePct: Math.round((top10 / total) * 10000) / 100, top: topRows, fetchedAt: new Date().toISOString() };
  });
}

/** Hourly candles for the Rialto pool from GeckoTerminal, oldest first, plus a change figure for the window. */
export async function tokenOhlcv(hours = 24): Promise<Ohlcv> {
  const pool = TRADE_POOLS.RIALTO.pool;
  const d = await gecko<{ data: { attributes: { ohlcv_list: [number, number, number, number, number, number][] } } }>(`/networks/robinhood/pools/${pool}/ohlcv/hour?aggregate=1&limit=${Math.min(Math.max(2, hours), 168)}`);
  const candles: Candle[] = [...d.data.attributes.ohlcv_list].sort((a, b) => a[0] - b[0]).map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v }));
  const first = candles[0]?.o ?? null;
  const last = candles[candles.length - 1]?.c ?? null;
  return { pool, hours: candles.length, candles, first, last, changePct: first && last ? Math.round(((last - first) / first) * 10000) / 100 : null, volumeUsd: Math.round(candles.reduce((a, c) => a + c.v, 0)) };
}


// ---------------------------------------------------------------------------------------------
// Token check: any ERC-20 on Robinhood Chain, read from the contract, its logs and GeckoTerminal.
// ---------------------------------------------------------------------------------------------
async function erc20String(token: string, selector: string): Promise<string | null> {
  try {
    const out = await rpc<string>("eth_call", [{ to: token, data: selector }, "latest"]);
    if (!out || out === "0x") return null;
    const hex = out.slice(2);
    // ABI-encoded string: offset, length, bytes. Some old tokens return bytes32.
    if (hex.length === 64) return Buffer.from(hex.replace(/(00)+$/, ""), "hex").toString("utf8") || null;
    const len = parseInt(hex.slice(64, 128), 16);
    return Buffer.from(hex.slice(128, 128 + len * 2), "hex").toString("utf8");
  } catch {
    return null;
  }
}

/** First Transfer of the token (its creation) found by bisecting the chain, so old tokens do not need a full scan. */
async function firstTransferBlock(token: string, head: number): Promise<number | null> {
  let lo = 0;
  let hi = head;
  const has = async (from: number, to: number) => {
    try {
      const logs = await rpc<Log[]>("eth_getLogs", [{ fromBlock: "0x" + from.toString(16), toBlock: "0x" + to.toString(16), address: token, topics: [TRANSFER_TOPIC] }]);
      return logs.length > 0;
    } catch {
      return true; // too many logs in the range means there are logs
    }
  };
  if (!(await has(0, head))) return null;
  while (hi - lo > 5_000) {
    const mid = Math.floor((lo + hi) / 2);
    if (await has(lo, mid)) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

export type TokenCheck = {
  address: string;
  isContract: boolean;
  name: string | null;
  symbol: string | null;
  decimals: number | null;
  totalSupply: string | null;
  officialRobinhoodToken: boolean;
  isRialto: boolean;
  createdBlock: number | null;
  createdAt: number | null;
  ageHours: number | null;
  transfers: number | null;
  holders: number | null;
  top10SharePct: number | null;
  top: { address: string; sharePct: number; isContract: boolean; label: string | null; explorerUrl: string }[];
  burnedPct: number | null;
  market: { priceUsd: number | null; liquidityUsd: number | null; volume24hUsd: number | null; pool: string | null; dex: string | null } | null;
  flags: { level: "ok" | "warn" | "bad"; text: string }[];
  scanned: boolean;
  explorerUrl: string;
  fetchedAt: string;
};

const CHECK_CACHE = new Map<string, { at: number; value: TokenCheck }>();

export async function tokenCheck(addressIn: string): Promise<TokenCheck> {
  if (!isAddress(addressIn)) throw new Error("Not an EVM address");
  const address = addressIn.toLowerCase();
  const hit = CHECK_CACHE.get(address);
  if (hit && Date.now() - hit.at < 120_000) return hit.value;
  const head = Number(BigInt(await rpc<string>("eth_blockNumber", [])));
  const [code, name, symbol, decHex, supplyRaw] = await Promise.all([
    rpc<string>("eth_getCode", [address, "latest"]),
    erc20String(address, "0x06fdde03"),
    erc20String(address, "0x95d89b41"),
    rpc<string>("eth_call", [{ to: address, data: "0x313ce567" }, "latest"]).catch(() => null),
    erc20Call(address, "0x18160ddd").catch(() => null),
  ]);
  const isContract = !!code && code !== "0x";
  const flags: TokenCheck["flags"] = [];
  if (!isContract) flags.push({ level: "bad", text: "Not a contract: this address is a wallet, not a token." });
  const decimals = decHex && decHex !== "0x" ? Number(BigInt(decHex)) : null;
  const totalSupply = supplyRaw !== null && decimals !== null ? formatUnits(supplyRaw, decimals) : null;
  const official = !!name && /Robinhood Token/i.test(name);
  const isRialto = address === TOKEN_CA.toLowerCase();
  if (official) flags.push({ level: "ok", text: 'Named "Robinhood Token": matches the official stock token naming.' });
  if (isRialto) flags.push({ level: "ok", text: "This is the Rialto token contract." });
  if (isContract && !name && !symbol) flags.push({ level: "warn", text: "No name or symbol: probably not an ERC-20." });

  // History
  let createdBlock: number | null = null;
  let createdAt: number | null = null;
  let transfers: number | null = null;
  let holders: number | null = null;
  let top10SharePct: number | null = null;
  let burnedPct: number | null = null;
  let top: TokenCheck["top"] = [];
  let scanned = false;
  if (isContract && supplyRaw !== null && decimals !== null) {
    createdBlock = isRialto ? 58_726_129 : await firstTransferBlock(address, head);
    if (createdBlock !== null) {
      createdAt = await blockTimestamp(createdBlock).catch(() => null);
      // Replaying every transfer is only cheap for young tokens (about 2.5 days at 0.1 s blocks), which are the ones
      // people need to check. Rialto itself comes from the cached ledger. Older tokens get identity, age and market only.
      const YOUNG = 2_000_000;
      let logs: Log[] | null = null;
      if (isRialto) {
        const h = await tokenHolders(5).catch(() => null);
        const b = await tokenBurns().catch(() => null);
        if (h) {
          scanned = true;
          transfers = h.transfers;
          holders = h.holders;
          top10SharePct = h.top10SharePct;
          top = h.top.map((r) => ({ address: r.address, sharePct: r.sharePct, isContract: r.isContract, label: r.label, explorerUrl: r.explorerUrl }));
          burnedPct = b?.burnedPct ?? null;
        }
      } else if (head - createdBlock <= YOUNG) {
        logs = await allTokenTransfers(address, createdBlock, 60_000).catch(() => null);
      } else {
        flags.push({ level: "ok", text: `Established token (${Math.round((head - createdBlock) / 854_599)} days on chain); holder replay skipped, see the explorer for holders.` });
      }
      if (logs && logs.length <= 60_000) {
        scanned = true;
        transfers = logs.length;
        const bal = new Map<string, bigint>();
        for (const l of logs) {
          const from = "0x" + l.topics[1].slice(26);
          const to = "0x" + l.topics[2].slice(26);
          const v = BigInt(l.data === "0x" ? "0x0" : l.data);
          if (l.topics[1] !== ZERO32) bal.set(from, (bal.get(from) ?? 0n) - v);
          bal.set(to, (bal.get(to) ?? 0n) + v);
        }
        const total = Number(supplyRaw) / 10 ** decimals;
        const rows = [...bal.entries()].filter(([a, v]) => v > 0n && a !== DEAD.toLowerCase()).map(([a, v]) => ({ address: a, balance: Number(v) / 10 ** decimals })).sort((a, b) => b.balance - a.balance);
        holders = rows.length;
        const deadBal = Number(bal.get(DEAD.toLowerCase()) ?? 0n) / 10 ** decimals;
        burnedPct = total > 0 ? Math.round((deadBal / total) * 10000) / 100 : null;
        top10SharePct = total > 0 ? Math.round((rows.slice(0, 10).reduce((a, r) => a + r.balance, 0) / total) * 10000) / 100 : null;
        top = await Promise.all(
          rows.slice(0, 5).map(async (r) => {
            const c = await rpc<string>("eth_getCode", [r.address, "latest"]).catch(() => "0x");
            const isC = !!c && c !== "0x";
            return { address: r.address, sharePct: total > 0 ? Math.round((r.balance / total) * 10000) / 100 : 0, isContract: isC, label: isC ? "contract (pool or vault)" : null, explorerUrl: `${EXPLORER}/address/${r.address}` };
          }),
        );
        const topWallet = top.find((t) => !t.isContract);
        if (topWallet && topWallet.sharePct >= 50) flags.push({ level: "bad", text: `One wallet holds ${topWallet.sharePct}% of the supply.` });
        else if (topWallet && topWallet.sharePct >= 20) flags.push({ level: "warn", text: `One wallet holds ${topWallet.sharePct}% of the supply.` });
        if (holders < 20) flags.push({ level: "warn", text: `Only ${holders} holders.` });
      } else if (logs) {
        flags.push({ level: "warn", text: "More than 60,000 transfers: holder replay skipped for this token." });
      }
    }
  }
  const ageHours = createdAt ? Math.round((Date.now() / 1000 - createdAt) / 360) / 10 : null;
  if (ageHours !== null && ageHours < 24) flags.push({ level: "warn", text: `Created ${ageHours} hours ago.` });

  // Market
  let market: TokenCheck["market"] = null;
  if (isContract) {
    try {
      const t = await tokenStats(address);
      market = { priceUsd: t.priceUsd, liquidityUsd: t.liquidityUsd, volume24hUsd: t.volume24hUsd, pool: t.pool?.address ?? null, dex: t.pool?.dex ?? null };
      if (t.liquidityUsd !== null && t.liquidityUsd < 1_000) flags.push({ level: "warn", text: `Thin liquidity: $${Math.round(t.liquidityUsd)} in the main pool.` });
    } catch {
      market = null;
      flags.push({ level: "warn", text: "No pool found on GeckoTerminal (or the price feed is rate limited)." });
    }
  }
  if (flags.length === 0 || flags.every((f) => f.level === "ok")) flags.push({ level: "ok", text: "No red flags from the checks above. That is not an endorsement." });
  const value: TokenCheck = { address, isContract, name, symbol, decimals, totalSupply, officialRobinhoodToken: official, isRialto, createdBlock, createdAt, ageHours, transfers, holders, top10SharePct, top, burnedPct, market, flags, scanned, explorerUrl: `${EXPLORER}/token/${address}`, fetchedAt: new Date().toISOString() };
  if (CHECK_CACHE.size > 200) CHECK_CACHE.clear();
  CHECK_CACHE.set(address, { at: Date.now(), value });
  return value;
}


// ---------------------------------------------------------------------------------------------
// Flywheel: x402 revenue in USDG lands in the treasury; the treasury buys Rialto back and burns it.
// ---------------------------------------------------------------------------------------------
const TREASURY_ADDR = "0x987e58beD5028b28cFe5E8c709b8533D6F908ebE";
const USDG_LAUNCH_BLOCK = 58_726_000;

export type Flywheel = {
  treasury: string;
  revenue: { usdgTotal: number; payments: number; latest: { from: string; amount: number; block: number; tx: string; explorerUrl: string }[] };
  burnedByTreasury: number;
  burnedTotal: number;
  balances: { usdg: number; rialto: number };
  prices: Record<string, string>;
  nextBurn: { thresholdUsdg: number; progressUsdg: number; pct: number };
  discounts: Record<string, string>;
  fetchedAt: string;
};

/** Everything the flywheel has done so far, read from the chain. Cached for a minute. */
export async function flywheel(): Promise<Flywheel> {
  return cached<Flywheel>("flywheel", 60_000, async () => {
    const head = Number(BigInt(await rpc<string>("eth_blockNumber", [])));
    const inflows: Log[] = [];
    const scan = async (from: number, to: number): Promise<void> => {
      try {
        inflows.push(...(await rpc<Log[]>("eth_getLogs", [{ fromBlock: "0x" + from.toString(16), toBlock: "0x" + to.toString(16), address: USDG, topics: [TRANSFER_TOPIC, null, topicAddr(TREASURY_ADDR)] }])));
      } catch {
        if (to - from > 2000) {
          const mid = Math.floor((from + to) / 2);
          await scan(from, mid);
          await scan(mid + 1, to);
        }
      }
    };
    await scan(USDG_LAUNCH_BLOCK, head);
    const rows = inflows.map((l) => ({ from: "0x" + l.topics[1].slice(26), amount: Number(BigInt(l.data === "0x" ? "0x0" : l.data)) / 1e6, block: Number(BigInt(l.blockNumber)), tx: l.transactionHash, explorerUrl: `${EXPLORER}/tx/${l.transactionHash}` })).sort((a, b) => b.block - a.block);
    const [burns, usdgBal, rialtoBal] = await Promise.all([tokenBurns().catch(() => null), erc20Call(USDG, "0x70a08231", TREASURY_ADDR).catch(() => 0n), rialtoBalance(TREASURY_ADDR).catch(() => ({ balance: "0" }))]);
    const byTreasury = (burns?.burns ?? []).filter((b) => b.from.toLowerCase() === TREASURY_ADDR.toLowerCase()).reduce((a, b) => a + b.amountNum, 0);
    return {
      treasury: TREASURY_ADDR,
      revenue: { usdgTotal: Math.round(rows.reduce((a, r) => a + r.amount, 0) * 1e6) / 1e6, payments: rows.length, latest: rows.slice(0, 10) },
      burnedByTreasury: Math.round(byTreasury),
      burnedTotal: burns?.burnedTotal ?? 0,
      balances: { usdg: Number(usdgBal) / 1e6, rialto: Math.round(Number(rialtoBal.balance)) },
      prices: { "GET /x402/check/{address}": "0.02 USDG", "GET /x402/portfolio/{address}": "0.01 USDG", "GET /x402/pulse": "0.005 USDG", "POST /x402/batch": "0.05 USDG" },
      nextBurn: { thresholdUsdg: 5, progressUsdg: Number(usdgBal) / 1e6, pct: Math.min(100, Math.round((Number(usdgBal) / 1e6 / 5) * 1000) / 10) },
      discounts: { Free: "list price", Holder: "50% off when signed in", Pro: "75% off when signed in", "Pay in Rialto": "burn the call's price in Rialto instead of paying USDG" },
      fetchedAt: new Date().toISOString(),
    };
  });
}

/** Burn-to-unlock: every 10,000 Rialto an address sends to the dead address buys 24 hours of Pro access, up to 30 days per burn. */
export async function burnAccess(address: string): Promise<{ active: boolean; until: number | null; burns: { amount: number; timestamp: number; hours: number; tx: string }[] }> {
  const key = "burnaccess:" + address.toLowerCase();
  return cached(key, 60_000, async () => {
    const logs = await rpc<Log[]>("eth_getLogs", [{ fromBlock: "0x" + (58_726_000).toString(16), toBlock: "latest", address: TOKEN_CA, topics: [TRANSFER_TOPIC, topicAddr(address), topicAddr(DEAD)] }]).catch(() => [] as Log[]);
    const burns = [];
    let until: number | null = null;
    for (const l of logs) {
      const amount = Number(BigInt(l.data === "0x" ? "0x0" : l.data)) / 1e18;
      if (amount < 10_000) continue;
      const ts = await blockTimestamp(Number(BigInt(l.blockNumber))).catch(() => null);
      if (ts === null) continue;
      const hours = Math.min(24 * Math.floor(amount / 10_000), 24 * 30);
      const end = ts + hours * 3600;
      burns.push({ amount: Math.round(amount), timestamp: ts, hours, tx: l.transactionHash });
      if (until === null || end > until) until = end;
    }
    const now = Math.floor(Date.now() / 1000);
    return { active: until !== null && until > now, until, burns };
  });
}


/** Live Rialto price in USD from GeckoTerminal (cached with the rest of the gecko reads). */
export async function rialtoPriceUsd(): Promise<number | null> {
  const t = await tokenStats(TOKEN_CA);
  return t.priceUsd;
}

// Pay in Rialto: a transfer to the dead address is the receipt. Each hash is accepted once per instance and only
// while the burn is fresh, which keeps a burn from paying for many calls.
const USED_BURNS = new Map<string, number>();
const BURN_MAX_AGE_S = 30 * 60;
export async function verifyBurnPayment(txHash: string, minRialto: number): Promise<{ ok: true; from: string; amount: number } | { ok: false; error: string }> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) return { ok: false, error: "x-rialto-burn must be a transaction hash" };
  const key = txHash.toLowerCase();
  for (const [k, t] of USED_BURNS) if (Date.now() - t > BURN_MAX_AGE_S * 1000) USED_BURNS.delete(k);
  if (USED_BURNS.has(key)) return { ok: false, error: "This burn was already used to pay for a call" };
  const rc = await rpc<{ status: string; blockNumber: string; logs: Log[] } | null>("eth_getTransactionReceipt", [txHash]).catch(() => null);
  if (!rc) return { ok: false, error: "Transaction not found yet; wait for it to be mined and retry" };
  if (rc.status !== "0x1") return { ok: false, error: "Transaction reverted" };
  const ts = await blockTimestamp(Number(BigInt(rc.blockNumber))).catch(() => 0);
  if (Date.now() / 1000 - ts > BURN_MAX_AGE_S) return { ok: false, error: `Burn is older than ${BURN_MAX_AGE_S / 60} minutes` };
  const burn = rc.logs.find((l) => l.address?.toLowerCase() === TOKEN_CA.toLowerCase() && l.topics[0] === TRANSFER_TOPIC && l.topics[2] === topicAddr(DEAD));
  if (!burn) return { ok: false, error: "No Rialto transfer to the dead address in this transaction" };
  const amount = Number(BigInt(burn.data === "0x" ? "0x0" : burn.data)) / 1e18;
  if (amount + 1e-9 < minRialto) return { ok: false, error: `Burn of ${Math.floor(amount)} Rialto is below the price of ${minRialto} Rialto` };
  USED_BURNS.set(key, Date.now());
  return { ok: true, from: "0x" + burn.topics[1].slice(26), amount: Math.floor(amount) };
}
