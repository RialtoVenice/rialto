/** Live feeds: USDG transfers from the chain logs, trades from GeckoTerminal. Same shapes as the hosted API. */
import { erc20Abi, formatUnits, isAddress, parseAbiItem, parseUnits, type Address } from "viem";
import { GECKOTERMINAL_API, GECKOTERMINAL_NETWORK, ROBINHOOD_EXPLORER, USDG_ADDRESS } from "./chains.js";
import { HOSTED_ORIGIN, RIALTO_TOKEN } from "./access.js";
import { findStock } from "./stocks.js";
import { getAccount, robinhoodClient, robinhoodWallet } from "./wallet.js";

const TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");

export async function usdgTransfers(blocks = 120, limit = 40) {
  const client = robinhoodClient();
  const head = await client.getBlockNumber();
  const span = BigInt(Math.min(Math.max(10, blocks), 400));
  const logs = await client.getLogs({ address: USDG_ADDRESS, event: TRANSFER, fromBlock: head - span, toBlock: head });
  const all = logs.map((l) => {
    const v = l.args.value ?? 0n;
    return { from: l.args.from as string, to: l.args.to as string, amount: formatUnits(v, 6), amountNum: Number(v) / 1e6, block: Number(l.blockNumber), tx: l.transactionHash, explorerUrl: `${ROBINHOOD_EXPLORER}/tx/${l.transactionHash}` };
  });
  const volume = all.reduce((a, t) => a + t.amountNum, 0);
  return {
    fromBlock: Number(head - span),
    toBlock: Number(head),
    blocks: Number(span),
    count: all.length,
    volumeUsdg: Math.round(volume * 100) / 100,
    largest: [...all].sort((a, b) => b.amountNum - a.amountNum).slice(0, limit),
    latest: [...all].sort((a, b) => b.block - a.block).slice(0, limit),
  };
}

export const TRADE_POOLS: Record<string, { pool: string; token: string; label: string }> = {
  RIALTO: { pool: "0xf9aec85dd4eb9ec9148e0b4b50a3fd8e9886dcae6ecc979f9369b84b01037c0b", token: RIALTO_TOKEN, label: "Rialto / ETH" },
  AAPL: { pool: "0xaae0d815ee56e4092a5e5c2911e676fea50b2d6d", token: "0xaf3d76f1834a1d425780943c99ea8a608f8a93f9", label: "AAPL / USDG" },
  TSLA: { pool: "0xf4acdaeeb7022862a763c9b1b885e11191c889e3", token: "0x322f0929c4625ed5bad873c95208d54e1c003b2d", label: "TSLA / USDG" },
  NVDA: { pool: "0xd4eb21209c4d6093f80b5b84f5c45cc093ea14a3", token: "0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec", label: "NVDA / USDG" },
};

type GtTrade = { attributes: { block_timestamp: string; kind: "buy" | "sell"; volume_in_usd: string; tx_hash: string; tx_from_address: string; from_token_amount: string; to_token_amount: string; from_token_address: string; to_token_address: string; price_from_in_usd: string; price_to_in_usd: string } };

export async function poolTrades(pool: string, token: string, limit = 40) {
  const res = await fetch(`${GECKOTERMINAL_API}/networks/${GECKOTERMINAL_NETWORK}/pools/${pool.toLowerCase()}/trades?trade_volume_in_usd_greater_than=0`, { headers: { accept: "application/json" } });
  if (res.status === 429) throw new Error("GeckoTerminal rate limit (30 requests per minute). Retry shortly.");
  if (!res.ok) throw new Error(`GeckoTerminal ${res.status}`);
  const data = (await res.json()) as { data: GtTrade[] };
  const t = token.toLowerCase();
  const trades = data.data.map(({ attributes: a }) => {
    const tokenIsTo = a.to_token_address.toLowerCase() === t;
    return { time: a.block_timestamp, kind: a.kind, usd: Number(a.volume_in_usd), priceUsd: Number(tokenIsTo ? a.price_to_in_usd : a.price_from_in_usd), tokenAmount: Number(tokenIsTo ? a.to_token_amount : a.from_token_amount), trader: a.tx_from_address, tx: a.tx_hash, explorerUrl: `${ROBINHOOD_EXPLORER}/tx/${a.tx_hash}` };
  });
  const hourAgo = Date.now() - 3600_000;
  const lastHour = trades.filter((x) => Date.parse(x.time) >= hourAgo);
  const sum = (k: "buy" | "sell") => Math.round(lastHour.filter((x) => x.kind === k).reduce((a, x) => a + x.usd, 0) * 100) / 100;
  return { pool, token, lastPriceUsd: trades[0]?.priceUsd ?? null, lastHour: { trades: lastHour.length, buys: lastHour.filter((x) => x.kind === "buy").length, sells: lastHour.filter((x) => x.kind === "sell").length, buyUsd: sum("buy"), sellUsd: sum("sell") }, trades: trades.slice(0, limit) };
}

export async function recentTrades(symbolOrPool = "RIALTO", limit = 40) {
  const key = symbolOrPool.toUpperCase();
  const known = TRADE_POOLS[key];
  if (known) return { symbol: key, label: known.label, ...(await poolTrades(known.pool, known.token, limit)) };
  const found = await findStock(key);
  const hit = found.find((f) => f.symbol.toUpperCase() === key && f.poolAddress);
  if (!hit?.poolAddress) throw new Error(`No pool found for ${symbolOrPool}. Try RIALTO, AAPL, TSLA, NVDA or a ticker.`);
  return { symbol: hit.symbol, label: hit.name, ...(await poolTrades(hit.poolAddress, hit.address as Address, limit)) };
}

/** GET a hosted API path (rialto.casa by default, RIALTO_HOSTED_ORIGIN to point elsewhere) and unwrap its envelope. */
export async function hosted<T = unknown>(path: string, timeoutMs = 60_000, origin = HOSTED_ORIGIN): Promise<T> {
  const res = await fetch(`${origin}${path}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs) });
  const j = (await res.json().catch(() => null)) as { ok?: boolean; data?: T; error?: unknown } | null;
  // A host-level answer (paused deployment, gateway error) has no {ok} envelope: say so plainly instead of printing an object.
  if (!j || typeof j.ok !== "boolean") {
    const why = res.status === 402 ? "is paused by its host (HTTP 402)" : `answered HTTP ${res.status} without a Rialto envelope`;
    throw new Error(`${origin} ${why}. The hosted ledger is unavailable right now; retry later or point RIALTO_HOSTED_ORIGIN at another instance.`);
  }
  if (!j.ok || j.data === undefined) throw new Error(typeof j.error === "string" ? j.error : j.error ? JSON.stringify(j.error) : `${path} failed (${res.status})`);
  return j.data;
}

/** Token check through the hosted API (identity, supply, age, holders replayed from logs, liquidity, flags). */
export async function tokenCheck(address: string, origin = HOSTED_ORIGIN) {
  if (!isAddress(address)) throw new Error("Not an EVM address");
  return hosted(`/api/check/${address}`, 90_000, origin);
}

export type RialtoToken = {
  name: string;
  symbol: string;
  priceUsd: number | null;
  fdvUsd: number | null;
  liquidityUsd: number | null;
  volume24hUsd: number | null;
  pool: { name: string; address: string; dex?: string } | null;
  volume: { sinceLaunchUsd: number; pools: number; poolsCounted: number; partial: boolean; since: string; snapshotAt: string } | null;
};
export type RialtoBurn = { block: number; timestamp: number | null; from: string; amount: string; amountNum: number; tx: string; explorerUrl: string };
export type RialtoBurns = { token: string; deadAddress: string; count: number; burnedTotal: number; burnedPct: number; burns: RialtoBurn[] };
export type RialtoHolders = { token: string; holders: number; transfers: number; asOfBlock: number; top10SharePct: number; top: { address: string; balance: number; sharePct: number; label: string | null; isContract: boolean; explorerUrl: string }[]; fetchedAt: string };
export type Pulse = {
  chain: { chainId: number; blockNumber: number; gasPriceGwei: string };
  latestBlock: { number: number; timestamp: number; txCount: number; gasUsed: number };
  usdg: { blocks: number; transfers: number; volumeUsdg: number; largest: { from: string; to: string; amountNum: number; tx: string }[]; latest: { from: string; to: string; amountNum: number; tx: string }[] };
  rialto: null | { lastPriceUsd: number | null; lastHour: { trades: number; buys: number; sells: number; buyUsd: number; sellUsd: number }; trades: { time: string; kind: "buy" | "sell"; usd: number; priceUsd: number; tokenAmount: number; trader: string; tx: string }[] };
  fetchedAt: string;
};

/** Rialto token stats: price, FDV, liquidity, 24h volume, volume since launch across every pool. */
export const rialtoToken = () => hosted<RialtoToken>("/api/token");
/** Every burn of the Rialto token, from the chain logs, with the running total. */
export const rialtoBurns = () => hosted<RialtoBurns>("/api/token/burns");
/** Holder count and top holders, replayed from every transfer, with the block the figures are current to. */
export const rialtoHolders = (top = 10) => hosted<RialtoHolders>(`/api/token/holders?top=${Math.min(Math.max(1, top), 50)}`);
/** One-shot live summary of Robinhood Chain: latest block, USDG flow, Rialto tape. */
export const pulse = () => hosted<Pulse>("/api/live/pulse");

export type RialtoHistory = { history: { day: string; block: number; holders: number; burned: number; transfers: number; walletsEver: number }[]; distribution: { label: string; min: number; wallets: number; tokens: number }[]; asOfBlock: number; holders: number; walletsEver: number };
export type ChainVitals = { blocksPerSecond: number; avgBlockMs: number; sampledBlocks: number; transferFeeEth: number; transferFeeUsd: number | null; ethPriceUsd: number | null };

/** Growth of the Rialto token day by day since launch, replayed from every transfer, plus the wallet distribution by tier bucket. */
export const rialtoHistory = () => hosted<RialtoHistory>("/api/token/history", 90_000);
/** Measured chain vitals: blocks per second over the last 2,000 blocks, average block time, fee of one token transfer. */
export const chainVitals = async () => (await hosted<{ vitals: ChainVitals | null }>("/api/chain")).vitals;

export type RialtoRank = {
  address: string; balance: number; sharePct: number; rank: number | null; holders: number; topPct: number | null;
  tier: "Free" | "Holder" | "Pro"; nextTier: { name: "Holder" | "Pro"; need: number } | null;
  walletNo: number | null; walletsEver: number; firstBlock: number | null; firstSeen: string | null; firstDay: string | null; daysHeld: number | null; lastBlock: number | null;
  received: number; sent: number; burned: number; transfers: number; dayOne: boolean; diamond: boolean; label: string | null;
  explorerUrl: string; badgeUrl: string; shareUrl: string; shareText: string; asOfBlock: number;
};
export type RialtoLeaderboard = {
  rows: { rank: number; address: string; balance: number; sharePct: number; firstDay: string | null; walletNo: number; diamond: boolean; dayOne: boolean; label: string | null; explorerUrl: string }[];
  holders: number; walletsEver: number; diamondHands: number; dayOneStillHolding: number; dayOneWallets: number; exited: number; medianBalance: number; asOfBlock: number; fetchedAt: string;
};

/** Where a wallet stands on the Rialto ledger: rank, wallet number since launch, days held, never-sold and day-one flags, share text, badge. */
export const rialtoRank = (address: string) => hosted<RialtoRank>(`/api/token/wallet/${address}`, 90_000);
/** Top holders with rank, first day and diamond-hands flag, plus cohort figures (diamond hands, day-one still holding, exited, median). */
export const rialtoLeaderboard = (limit = 25) => hosted<RialtoLeaderboard>(`/api/token/leaderboard?limit=${Math.min(Math.max(1, limit), 100)}`, 90_000);

/** Badge of a wallet: the SVG text (from /badge/{address}.svg), its URL and a Markdown snippet for a README. */
export async function rialtoBadge(address: string, origin = HOSTED_ORIGIN): Promise<{ url: string; markdown: string; svg: string }> {
  const url = `${origin}/badge/${address.toLowerCase()}.svg`;
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`badge: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return { url, markdown: `[![Rialto](${url})](${origin}/#tab-rank)`, svg: await res.text() };
}

/** Rialto balance of an address, in whole tokens, straight from the contract. */
export async function rialtoBalanceOf(address: Address): Promise<number> {
  const raw = await robinhoodClient().readContract({ address: RIALTO_TOKEN, abi: erc20Abi, functionName: "balanceOf", args: [address] });
  return Number(raw) / 1e18;
}

export type WatchEvent =
  | { type: "block"; number: number; txCount: number }
  | { type: "usdg"; blocks: number; transfers: number; volumeUsdg: number }
  | { type: "trade"; kind: "buy" | "sell"; usd: number; priceUsd: number; tokenAmount: number; trader: string; tx: string; explorerUrl: string }
  | { type: "burn"; amount: number; from: string; tx: string; explorerUrl: string; burnedTotal: number; burnedPct: number }
  | { type: "wallet"; address: string; field: "eth" | "usdg" | "rialto"; before: number; after: number }
  | { type: "rank"; address: string; rank: number | null; before: number | null; holders: number; walletNo: number | null; diamond: boolean }
  | { type: "error"; message: string };

/**
 * Follow the chain from the terminal: yields an event whenever the block moves, USDG flow changes, a Rialto trade
 * lands, a burn is found, or (with a wallet) a balance changes. Polls the hosted API and the chain, nothing else.
 */
export async function* watch(opts: { wallet?: Address; everyMs?: number; once?: boolean } = {}): AsyncGenerator<WatchEvent> {
  const every = Math.max(5_000, opts.everyMs ?? 15_000);
  // The rank is read at most once a minute: it moves with other people's trades, not with every block.
  const rankEvery = Math.max(1, Math.ceil(60_000 / every));
  let pass = 0;
  let lastRank: number | null | undefined;
  let lastBlock = 0;
  let lastUsdg = "";
  let seenTrades = new Set<string>();
  let burnCount = -1;
  let wallet: { eth: number; usdg: number; rialto: number } | null = null;
  let first = true;
  for (;;) {
    try {
      const [p, b] = await Promise.all([pulse(), rialtoBurns()]);
      if (p.latestBlock.number !== lastBlock) {
        lastBlock = p.latestBlock.number;
        yield { type: "block", number: p.latestBlock.number, txCount: p.latestBlock.txCount };
      }
      const usdgKey = `${p.usdg.transfers}/${p.usdg.volumeUsdg}`;
      if (usdgKey !== lastUsdg) {
        lastUsdg = usdgKey;
        yield { type: "usdg", blocks: p.usdg.blocks, transfers: p.usdg.transfers, volumeUsdg: p.usdg.volumeUsdg };
      }
      const tape = p.rialto?.trades ?? [];
      const fresh = tape.filter((t) => !seenTrades.has(t.tx));
      if (!first) for (const t of [...fresh].reverse()) yield { type: "trade", kind: t.kind, usd: t.usd, priceUsd: t.priceUsd, tokenAmount: t.tokenAmount, trader: t.trader, tx: t.tx, explorerUrl: `${ROBINHOOD_EXPLORER}/tx/${t.tx}` };
      if (p.rialto) seenTrades = new Set(tape.map((t) => t.tx));
      if (burnCount >= 0 && b.count > burnCount) for (const x of b.burns.slice(0, b.count - burnCount).reverse()) yield { type: "burn", amount: Math.round(x.amountNum), from: x.from, tx: x.tx, explorerUrl: x.explorerUrl, burnedTotal: b.burnedTotal, burnedPct: b.burnedPct };
      burnCount = b.count;
      if (opts.wallet) {
        const client = robinhoodClient();
        const [eth, usdg, rialto] = await Promise.all([
          client.getBalance({ address: opts.wallet }).then((v) => Number(v) / 1e18),
          client.readContract({ address: USDG_ADDRESS, abi: erc20Abi, functionName: "balanceOf", args: [opts.wallet] }).then((v) => Number(v) / 1e6),
          rialtoBalanceOf(opts.wallet),
        ]);
        const now = { eth, usdg, rialto };
        if (wallet) for (const k of ["eth", "usdg", "rialto"] as const) if (now[k] !== wallet[k]) yield { type: "wallet", address: opts.wallet, field: k, before: wallet[k], after: now[k] };
        wallet = now;
        if (pass % rankEvery === 0) {
          const r = await rialtoRank(opts.wallet).catch(() => null);
          if (r && r.rank !== lastRank) {
            yield { type: "rank", address: opts.wallet, rank: r.rank, before: lastRank ?? null, holders: r.holders, walletNo: r.walletNo, diamond: r.diamond };
            lastRank = r.rank;
          }
        }
      }
    } catch (e) {
      yield { type: "error", message: (e as Error).message };
    }
    first = false;
    pass++;
    if (opts.once) return;
    await new Promise((r) => setTimeout(r, every));
  }
}

export const DEAD_ADDRESS = "0x000000000000000000000000000000000000dEaD" as const;

/** Send Rialto from the wallet to the dead address. Irreversible. Every 10,000 buys 24 h of Pro on the hosted API. */
export async function burnRialto(amount: string): Promise<{ hash: `0x${string}`; amount: string; from: Address; explorerUrl: string; proHours: number }> {
  const value = parseUnits(amount, 18);
  if (value <= 0n) throw new Error("Amount must be positive");
  const wallet = robinhoodWallet();
  const client = robinhoodClient();
  const bal = await client.readContract({ address: RIALTO_TOKEN, abi: erc20Abi, functionName: "balanceOf", args: [getAccount().address] });
  if (bal < value) throw new Error(`Wallet holds ${formatUnits(bal, 18)} Rialto, cannot burn ${amount}`);
  const hash = await wallet.writeContract({ address: RIALTO_TOKEN, abi: erc20Abi, functionName: "transfer", args: [DEAD_ADDRESS, value] });
  await client.waitForTransactionReceipt({ hash });
  return { hash, amount, from: getAccount().address, explorerUrl: `${ROBINHOOD_EXPLORER}/tx/${hash}`, proHours: Math.min(24 * Math.floor(Number(amount) / 10_000), 24 * 30) };
}

/** Flywheel figures through the hosted API: x402 revenue, buybacks, burns, treasury balances. */
export const flywheel = (origin = HOSTED_ORIGIN) => hosted(`/api/flywheel`, 60_000, origin);
