/**
 * Rialto on Solana, server side: the mint (supply, holders, burns, trades, price), the chain, and where a wallet stands.
 * One RPC (SOLANA_RPC_URL, public mainnet by default), GeckoTerminal for prices, CoinGecko for SOL. Heavy scans are
 * cached in memory for a few minutes so the public endpoint is barely touched.
 */
import { Connection, PublicKey, LAMPORTS_PER_SOL, type ParsedInstruction, type ParsedTransactionWithMeta } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, getMint, type Mint } from "@solana/spl-token";
import { SOLANA_MINT } from "./site";

export const SOLANA_RPC = process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";
export const SOLANA_EXPLORER = "https://solscan.io";
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const GECKO = "https://api.geckoterminal.com/api/v2";

const conn = () => new Connection(SOLANA_RPC, { commitment: "confirmed" });

export function resolveMint(mint?: string | null): PublicKey {
  const v = mint || process.env.RIALTO_SOLANA_MINT || SOLANA_MINT;
  if (!v) throw new Error("The Rialto mint on Solana is not published yet.");
  return new PublicKey(v);
}

/** Burn since launch from supply alone: Rialto was created with 1,000,000,000 tokens and the mint authority is null, so supply only moves down. Only for the Rialto mint. */
export function burnedSinceLaunch(mint: PublicKey, supply: number): { initialSupply: number | null; burnedSinceLaunch: number | null; burnedPctOfInitial: number | null } {
  const env = process.env.RIALTO_SOLANA_INITIAL_SUPPLY;
  if (!mint.equals(resolveMint(null)) && !env) return { initialSupply: null, burnedSinceLaunch: null, burnedPctOfInitial: null };
  const initial = Number(env ?? 1_000_000_000);
  const burned = Math.max(0, initial - supply);
  return { initialSupply: initial, burnedSinceLaunch: Math.round(burned * 100) / 100, burnedPctOfInitial: Math.round((burned / initial) * 10000) / 100 };
}

const CACHE = new Map<string, { at: number; value: unknown; inflight?: Promise<unknown> }>();
async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = CACHE.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as T;
  if (hit?.inflight) return hit.inflight as Promise<T>;
  const inflight = fn().then((value) => {
    CACHE.set(key, { at: Date.now(), value });
    return value;
  }).catch((e) => {
    CACHE.delete(key);
    throw e;
  });
  CACHE.set(key, { at: hit?.at ?? 0, value: hit?.value, inflight });
  return inflight;
}

const ui = (raw: bigint | number | string, decimals: number) => Number(raw) / 10 ** decimals;
const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));

async function gecko<T>(path: string): Promise<T> {
  const res = await fetch(`${GECKO}${path}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
  if (res.status === 429) throw new Error("GeckoTerminal rate limit (30 requests per minute). Retry shortly.");
  if (!res.ok) throw new Error(`GeckoTerminal ${res.status}`);
  return (await res.json()) as T;
}

async function mintInfo(c: Connection, mint: PublicKey): Promise<{ info: Mint; program: PublicKey }> {
  const acc = await c.getAccountInfo(mint);
  if (!acc) throw new Error(`${mint.toBase58()} is not an account on Solana.`);
  const program = acc.owner.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
  if (!acc.owner.equals(TOKEN_PROGRAM_ID) && !acc.owner.equals(TOKEN_2022_PROGRAM_ID)) throw new Error(`${mint.toBase58()} is not an SPL mint.`);
  return { info: await getMint(c, mint, "confirmed", program), program };
}

/** Solana right now: slot, block time, SOL price. */
export async function solChain() {
  return cached("chain", 15_000, async () => {
    const c = conn();
    const slot = await c.getSlot();
    const [blockTime, sol] = await Promise.all([c.getBlockTime(slot).catch(() => null), solPriceUsd()]);
    return { chain: "solana", rpc: SOLANA_RPC.replace(/api-key=[^&]+/, "api-key=…"), slot, blockTime, solPriceUsd: sol, fetchedAt: new Date().toISOString() };
  });
}

async function solPriceUsd(): Promise<number | null> {
  return cached("solprice", 60_000, async () => {
    try {
      const r = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd", { signal: AbortSignal.timeout(8_000) });
      const j = (await r.json()) as { solana?: { usd?: number } };
      return j.solana?.usd ?? null;
    } catch {
      return null;
    }
  });
}

type GtPool = { attributes: { name: string; address: string; base_token_price_usd: string; fdv_usd: string; reserve_in_usd: string; volume_usd?: { h24?: string }; price_change_percentage?: { h24?: string } }; relationships?: { dex?: { data?: { id: string } } } };

/** Price, FDV, liquidity, 24h volume and the deepest pool of the mint, from GeckoTerminal. */
export async function solTokenStats(mintIn?: string | null) {
  const mint = resolveMint(mintIn).toBase58();
  return cached(`stats:${mint}`, 30_000, async () => {
    const pools = (await gecko<{ data: GtPool[] }>(`/networks/solana/tokens/${mint}/pools?page=1`)).data;
    const p = pools[0];
    const c = conn();
    const { info, program } = await mintInfo(c, new PublicKey(mint));
    return {
      chain: "solana",
      mint,
      program: program.equals(TOKEN_2022_PROGRAM_ID) ? "token-2022" : "token",
      decimals: info.decimals,
      supply: ui(info.supply, info.decimals),
      mintAuthority: info.mintAuthority?.toBase58() ?? null,
      freezeAuthority: info.freezeAuthority?.toBase58() ?? null,
      priceUsd: p ? num(p.attributes.base_token_price_usd) : null,
      fdvUsd: p ? num(p.attributes.fdv_usd) : null,
      liquidityUsd: p ? num(p.attributes.reserve_in_usd) : null,
      volume24hUsd: p ? num(p.attributes.volume_usd?.h24) : null,
      change24hPct: p ? num(p.attributes.price_change_percentage?.h24) : null,
      pools: pools.length,
      pool: p ? { name: p.attributes.name, address: p.attributes.address, dex: p.relationships?.dex?.data?.id ?? "" } : null,
      explorerUrl: `${SOLANA_EXPLORER}/token/${mint}`,
      fetchedAt: new Date().toISOString(),
    };
  });
}

export type SolHolderRow = { owner: string; amount: number; sharePct: number };
type Scan = { rows: SolHolderRow[]; tokenAccounts: number; supply: number; decimals: number; complete: boolean; note?: string; asOfSlot: number; fetchedAt: string };

/** Every holder of the mint by a full token-account scan, aggregated by owner, sorted. Cached for five minutes. */
async function scan(mintIn?: string | null): Promise<Scan> {
  const mint = resolveMint(mintIn);
  return cached(`scan:${mint.toBase58()}`, 5 * 60_000, async () => {
    const c = conn();
    const { info, program } = await mintInfo(c, mint);
    const supply = ui(info.supply, info.decimals);
    const asOfSlot = await c.getSlot();
    try {
      const filters = program.equals(TOKEN_PROGRAM_ID) ? [{ dataSize: 165 }, { memcmp: { offset: 0, bytes: mint.toBase58() } }] : [{ memcmp: { offset: 0, bytes: mint.toBase58() } }];
      const accounts = await c.getParsedProgramAccounts(program, { filters });
      const byOwner = new Map<string, number>();
      for (const a of accounts) {
        const d = a.account.data as { parsed?: { info: { owner: string; tokenAmount: { uiAmount: number | null } } } };
        const amt = Number(d.parsed?.info.tokenAmount.uiAmount ?? 0);
        if (amt <= 0) continue;
        byOwner.set(d.parsed!.info.owner, (byOwner.get(d.parsed!.info.owner) ?? 0) + amt);
      }
      const rows = [...byOwner.entries()].map(([owner, amount]) => ({ owner, amount, sharePct: supply ? Math.round((amount / supply) * 10000) / 100 : 0 })).sort((a, b) => b.amount - a.amount);
      return { rows, tokenAccounts: accounts.length, supply, decimals: info.decimals, complete: true, asOfSlot, fetchedAt: new Date().toISOString() };
    } catch (e) {
      const largest = await c.getTokenLargestAccounts(mint);
      const owners = await c.getMultipleParsedAccounts(largest.value.map((a) => a.address));
      const rows = largest.value.map((a, i) => {
        const acc = owners.value[i];
        const owner = acc && "parsed" in (acc.data as object) ? ((acc.data as { parsed: { info: { owner: string } } }).parsed.info.owner as string) : a.address.toBase58();
        const amount = Number(a.uiAmount ?? 0);
        return { owner, amount, sharePct: supply ? Math.round((amount / supply) * 10000) / 100 : 0 };
      });
      return { rows, tokenAccounts: rows.length, supply, decimals: info.decimals, complete: false, note: `Full scan refused by the RPC (${(e as Error).message.slice(0, 60)}); 20 largest accounts shown.`, asOfSlot, fetchedAt: new Date().toISOString() };
    }
  });
}

const KNOWN: Record<string, string> = {};
export function labelOf(owner: string): string | null {
  return KNOWN[owner] ?? null;
}

/** Holder count, top holders, concentration. */
export async function solHolders(mintIn?: string | null, top = 10) {
  const s = await scan(mintIn);
  const n = Math.min(Math.max(1, top), 100);
  return { chain: "solana", mint: resolveMint(mintIn).toBase58(), complete: s.complete, note: s.note, holders: s.complete ? s.rows.length : null, tokenAccounts: s.tokenAccounts, supply: s.supply, top10SharePct: Math.round(s.rows.slice(0, 10).reduce((a, r) => a + r.sharePct, 0) * 100) / 100, top: s.rows.slice(0, n).map((r) => ({ ...r, amount: Math.round(r.amount * 100) / 100, label: labelOf(r.owner), explorerUrl: `${SOLANA_EXPLORER}/account/${r.owner}` })), asOfSlot: s.asOfSlot, fetchedAt: s.fetchedAt };
}

/** Top holders with rank, plus cohort figures. */
export async function solLeaderboard(mintIn?: string | null, limit = 25) {
  const s = await scan(mintIn);
  const n = Math.min(Math.max(1, limit), 100);
  const balances = s.rows.map((r) => r.amount);
  const median = balances.length ? balances[Math.floor(balances.length / 2)] : 0;
  return { chain: "solana", mint: resolveMint(mintIn).toBase58(), complete: s.complete, holders: s.complete ? s.rows.length : null, medianBalance: Math.round(median), top10SharePct: Math.round(s.rows.slice(0, 10).reduce((a, r) => a + r.sharePct, 0) * 100) / 100, rows: s.rows.slice(0, n).map((r, i) => ({ rank: i + 1, owner: r.owner, amount: Math.round(r.amount), sharePct: r.sharePct, label: labelOf(r.owner), explorerUrl: `${SOLANA_EXPLORER}/account/${r.owner}` })), asOfSlot: s.asOfSlot, fetchedAt: s.fetchedAt };
}

/** Where one wallet stands: balance, rank, share, top percent. */
export async function solRank(address: string, mintIn?: string | null) {
  let owner: PublicKey;
  try {
    owner = new PublicKey(address);
  } catch {
    throw new Error("address must be a Solana public key (base58)");
  }
  const s = await scan(mintIn);
  const idx = s.rows.findIndex((r) => r.owner === owner.toBase58());
  const balance = idx >= 0 ? s.rows[idx].amount : 0;
  const rank = idx >= 0 ? idx + 1 : null;
  const holders = s.rows.length;
  const shareText = rank ? `Rank #${rank.toLocaleString("en-US")} of ${holders.toLocaleString("en-US")} Rialto holders on Solana. Check yours: https://rialto.casa/#tab-rank` : `Not a Rialto holder on Solana yet. Check yours: https://rialto.casa/#tab-rank`;
  return { chain: "solana", mint: resolveMint(mintIn).toBase58(), address: owner.toBase58(), balance: Math.round(balance * 100) / 100, sharePct: s.supply ? Math.round((balance / s.supply) * 100000) / 1000 : 0, rank, holders, topPct: rank ? Math.max(0.1, Math.round((rank / holders) * 1000) / 10) : null, complete: s.complete, explorerUrl: `${SOLANA_EXPLORER}/account/${owner.toBase58()}`, shareText, shareUrl: `https://x.com/intent/post?text=${encodeURIComponent(shareText)}`, asOfSlot: s.asOfSlot };
}

export type SolBurn = { signature: string; slot: number; time: string | null; authority: string; amount: number; explorerUrl: string };

/** Burn instructions in the mint's recent transactions. Sequential reads with backoff; cached ten minutes. */
export async function solBurns(mintIn?: string | null, scanN = 100) {
  const mint = resolveMint(mintIn);
  return cached(`burns:${mint.toBase58()}:${scanN}`, 10 * 60_000, async () => {
    const c = conn();
    const { info } = await mintInfo(c, mint);
    const sigs = await c.getSignaturesForAddress(mint, { limit: Math.min(1000, scanN) });
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const burns: SolBurn[] = [];
    let throttled = false;
    for (let i = 0; i < sigs.length; i++) {
      let tx: ParsedTransactionWithMeta | null = null;
      for (let attempt = 0; ; attempt++) {
        try {
          tx = await c.getParsedTransaction(sigs[i].signature, { maxSupportedTransactionVersion: 0 });
          break;
        } catch (e) {
          if (attempt >= 2 || !/429|Too many/i.test((e as Error).message)) {
            throttled = true;
            break;
          }
          await sleep(1500 * (attempt + 1));
        }
      }
      if (throttled) break;
      if (!tx || tx.meta?.err) continue;
      const top = tx.transaction.message.instructions as (ParsedInstruction | { programId: PublicKey })[];
      const inner = (tx.meta?.innerInstructions ?? []).flatMap((x) => x.instructions as (ParsedInstruction | { programId: PublicKey })[]);
      for (const ix of [...top, ...inner]) {
        if (!("parsed" in ix)) continue;
        const pi = ix as ParsedInstruction;
        if (pi.program !== "spl-token" && pi.program !== "spl-token-2022") continue;
        const p = pi.parsed as { type: string; info: { mint?: string; authority?: string; amount?: string; tokenAmount?: { amount?: string } } };
        if ((p.type === "burn" || p.type === "burnChecked") && p.info.mint === mint.toBase58()) {
          const raw = p.info.tokenAmount?.amount ?? p.info.amount ?? "0";
          burns.push({ signature: sigs[i].signature, slot: sigs[i].slot, time: tx.blockTime ? new Date(tx.blockTime * 1000).toISOString() : null, authority: p.info.authority ?? "", amount: ui(BigInt(raw), info.decimals), explorerUrl: `${SOLANA_EXPLORER}/tx/${sigs[i].signature}` });
        }
      }
      if (i + 1 < sigs.length) await sleep(120);
    }
    const total = burns.reduce((a, b) => a + b.amount, 0);
    const supply = ui(info.supply, info.decimals);
    return { chain: "solana", mint: mint.toBase58(), scannedTransactions: sigs.length, complete: !throttled, note: throttled ? "The RPC throttled transaction reads; the scan stopped early. Set SOLANA_RPC_URL to a private endpoint for a full list." : undefined, count: burns.length, burnedTotal: Math.round(total * 100) / 100, burnedPctOfCurrentSupply: supply ? Math.round((total / supply) * 10000) / 100 : null, ...burnedSinceLaunch(mint, supply), burns, fetchedAt: new Date().toISOString() };
  });
}

export type SolTrade = { time: string; kind: "buy" | "sell"; usd: number; priceUsd: number; tokenAmount: number; trader: string; tx: string; explorerUrl: string };

/** Recent trades on the deepest pool. */
export async function solTrades(mintIn?: string | null, limit = 40) {
  const mint = resolveMint(mintIn).toBase58();
  return cached(`trades:${mint}`, 20_000, async () => {
    const pools = (await gecko<{ data: GtPool[] }>(`/networks/solana/tokens/${mint}/pools?page=1`)).data;
    if (!pools[0]) throw new Error(`No pool lists ${mint} on GeckoTerminal yet.`);
    const pool = pools[0].attributes.address;
    type GtTrade = { attributes: { block_timestamp: string; kind: "buy" | "sell"; volume_in_usd: string; tx_hash: string; tx_from_address: string; from_token_amount: string; to_token_amount: string; from_token_address: string; to_token_address: string; price_from_in_usd: string; price_to_in_usd: string } };
    const d = await gecko<{ data: GtTrade[] }>(`/networks/solana/pools/${pool}/trades?trade_volume_in_usd_greater_than=0`);
    const trades: SolTrade[] = d.data.map(({ attributes: a }) => {
      const toIsMint = a.to_token_address === mint;
      return { time: a.block_timestamp, kind: a.kind, usd: Number(a.volume_in_usd), priceUsd: Number(toIsMint ? a.price_to_in_usd : a.price_from_in_usd), tokenAmount: Number(toIsMint ? a.to_token_amount : a.from_token_amount), trader: a.tx_from_address, tx: a.tx_hash, explorerUrl: `${SOLANA_EXPLORER}/tx/${a.tx_hash}` };
    });
    const hourAgo = Date.now() - 3600_000;
    const lastHour = trades.filter((x) => Date.parse(x.time) >= hourAgo);
    const sum = (k: "buy" | "sell") => Math.round(lastHour.filter((x) => x.kind === k).reduce((a, x) => a + x.usd, 0) * 100) / 100;
    return { chain: "solana", mint, pool, label: pools[0].attributes.name, lastPriceUsd: trades[0]?.priceUsd ?? null, lastHour: { trades: lastHour.length, buys: lastHour.filter((x) => x.kind === "buy").length, sells: lastHour.filter((x) => x.kind === "sell").length, buyUsd: sum("buy"), sellUsd: sum("sell") }, trades: trades.slice(0, Math.min(limit, 100)), fetchedAt: new Date().toISOString() };
  });
}

/** Balances of a wallet: SOL, USDC, Rialto. */
export async function solWallet(address: string, mintIn?: string | null) {
  const owner = new PublicKey(address);
  const c = conn();
  const bal = async (mint: PublicKey) => (await c.getParsedTokenAccountsByOwner(owner, { mint })).value.reduce((a, x) => a + Number(x.account.data.parsed.info.tokenAmount.uiAmount ?? 0), 0);
  const [lamports, usdc] = await Promise.all([c.getBalance(owner), bal(new PublicKey(USDC_MINT))]);
  let rialto: number | null = null;
  try {
    rialto = await bal(resolveMint(mintIn));
  } catch {
    /* no mint yet */
  }
  return { chain: "solana", address: owner.toBase58(), sol: lamports / LAMPORTS_PER_SOL, usdc, rialto, explorerUrl: `${SOLANA_EXPLORER}/account/${owner.toBase58()}` };
}
