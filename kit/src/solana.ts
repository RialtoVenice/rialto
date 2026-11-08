/**
 * Rialto on Solana: wallet, balances, the Rialto SPL mint (supply, holders, burns), trade tape, and USDC or SOL transfers.
 * Reads go to one JSON-RPC endpoint (SOLANA_RPC_URL, public mainnet by default) and to GeckoTerminal for prices.
 */
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction, type ParsedInstruction, type ParsedTransactionWithMeta } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, createAssociatedTokenAccountIdempotentInstruction, createBurnCheckedInstruction, createTransferCheckedInstruction, getAssociatedTokenAddress, getMint, type Mint } from "@solana/spl-token";
import bs58 from "bs58";
import { readConfig, resolveConfig, writeConfig } from "./config.js";

export const SOLANA_RPC = process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";
export const SOLANA_EXPLORER = "https://solscan.io";
export const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const GECKO = "https://api.geckoterminal.com/api/v2";

export function solanaConnection(): Connection {
  return new Connection(SOLANA_RPC, { commitment: "confirmed", disableRetryOnRateLimit: false });
}

export function isSolanaAddress(v: unknown): v is string {
  if (typeof v !== "string" || v.length < 32 || v.length > 44) return false;
  try {
    return PublicKey.isOnCurve(new PublicKey(v).toBytes()) || true;
  } catch {
    return false;
  }
}

/** The Solana keypair of this install, from SOLANA_SECRET_KEY (base58) or the config file. */
export function getSolanaKeypair(): Keypair {
  const secret = process.env.SOLANA_SECRET_KEY ?? readConfig().solanaSecret;
  if (!secret) throw new Error("No Solana wallet configured. Run `rialto sol init` first (or set SOLANA_SECRET_KEY, base58).");
  return Keypair.fromSecretKey(bs58.decode(secret));
}

/** Create the Solana keypair if none exists. The secret stays in ~/.rialto/config.json (mode 600) next to the EVM key. */
export function ensureSolanaWallet(): { address: string; created: boolean } {
  try {
    return { address: getSolanaKeypair().publicKey.toBase58(), created: false };
  } catch {
    const kp = Keypair.generate();
    writeConfig({ ...readConfig(), solanaSecret: bs58.encode(kp.secretKey) });
    return { address: kp.publicKey.toBase58(), created: true };
  }
}

/** The Rialto mint on Solana: argument, RIALTO_SOLANA_MINT, or the config file. */
export function resolveMint(mint?: string): PublicKey {
  const v = mint ?? process.env.RIALTO_SOLANA_MINT ?? resolveConfig().solanaMint;
  if (!v) throw new Error("No Rialto mint on Solana configured yet. Pass a mint address, or run `rialto sol config mint <address>` once the token is live.");
  return new PublicKey(v);
}

/**
 * Burn since launch, derived from supply. Rialto was created with 1,000,000,000 tokens and its mint authority is null,
 * so supply only ever moves down: initial minus current is everything burned, with no transaction scan and no RPC limit.
 * Only computed for the configured Rialto mint (or when RIALTO_SOLANA_INITIAL_SUPPLY is set for another mint).
 */
export function burnedSinceLaunch(mint: PublicKey, supply: number): { initialSupply: number | null; burnedSinceLaunch: number | null; burnedPctOfInitial: number | null } {
  let isDefault = false;
  try {
    isDefault = mint.equals(resolveMint());
  } catch {
    isDefault = false;
  }
  const env = process.env.RIALTO_SOLANA_INITIAL_SUPPLY;
  if (!isDefault && !env) return { initialSupply: null, burnedSinceLaunch: null, burnedPctOfInitial: null };
  const initial = Number(env ?? 1_000_000_000);
  const burned = Math.max(0, initial - supply);
  return { initialSupply: initial, burnedSinceLaunch: Math.round(burned * 100) / 100, burnedPctOfInitial: Math.round((burned / initial) * 10000) / 100 };
}

const ui = (raw: bigint | number | string, decimals: number) => Number(raw) / 10 ** decimals;

/** Mint facts plus the token program that owns the mint (classic Token or Token-2022), read from the account itself. */
async function mintInfo(conn: Connection, mint: PublicKey): Promise<{ info: Mint; program: PublicKey }> {
  const acc = await conn.getAccountInfo(mint);
  if (!acc) throw new Error(`${mint.toBase58()} is not an account on Solana (${SOLANA_RPC}).`);
  const program = acc.owner.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
  if (!acc.owner.equals(TOKEN_PROGRAM_ID) && !acc.owner.equals(TOKEN_2022_PROGRAM_ID)) throw new Error(`${mint.toBase58()} is not an SPL mint (owned by ${acc.owner.toBase58()}).`);
  return { info: await getMint(conn, mint, "confirmed", program), program };
}

type OwnerRow = { owner: string; amount: number; sharePct: number };
/** Every holder of the mint by walking its token accounts; aggregated by owner, sorted by amount. */
async function scanHolders(conn: Connection, mint: PublicKey, supply: number, program: PublicKey): Promise<{ rows: OwnerRow[]; tokenAccounts: number }> {
  // Token-2022 accounts carry extensions, so their size varies: filter on the mint field only.
  const filters = program.equals(TOKEN_PROGRAM_ID) ? [{ dataSize: 165 }, { memcmp: { offset: 0, bytes: mint.toBase58() } }] : [{ memcmp: { offset: 0, bytes: mint.toBase58() } }];
  const accounts = await conn.getParsedProgramAccounts(program, { filters });
  const byOwner = new Map<string, number>();
  for (const a of accounts) {
    const d = a.account.data as { parsed?: { info: { owner: string; tokenAmount: { uiAmount: number | null } } } };
    const amt = Number(d.parsed?.info.tokenAmount.uiAmount ?? 0);
    if (amt <= 0) continue;
    const o = d.parsed!.info.owner;
    byOwner.set(o, (byOwner.get(o) ?? 0) + amt);
  }
  const rows = [...byOwner.entries()].map(([owner, amount]) => ({ owner, amount, sharePct: supply ? Math.round((amount / supply) * 10000) / 100 : 0 })).sort((a, b) => b.amount - a.amount);
  return { rows, tokenAccounts: accounts.length };
}

/** The 20 largest token accounts resolved to owners (getTokenLargestAccounts), for endpoints that refuse the full scan. */
async function largestAccounts(conn: Connection, mint: PublicKey, supply: number): Promise<OwnerRow[]> {
  const largest = await conn.getTokenLargestAccounts(mint);
  const accounts = largest.value.map((a) => a.address);
  const owners = accounts.length ? await conn.getMultipleParsedAccounts(accounts) : { value: [] };
  return largest.value.map((a, i) => {
    const acc = owners.value[i];
    const owner = acc && "parsed" in (acc.data as object) ? ((acc.data as { parsed: { info: { owner: string } } }).parsed.info.owner as string) : a.address.toBase58();
    const amount = Number(a.uiAmount ?? 0);
    return { owner, amount, sharePct: supply ? Math.round((amount / supply) * 10000) / 100 : 0 };
  });
}

async function tokenBalance(conn: Connection, owner: PublicKey, mint: PublicKey): Promise<number> {
  const r = await conn.getParsedTokenAccountsByOwner(owner, { mint });
  return r.value.reduce((a, x) => a + Number(x.account.data.parsed.info.tokenAmount.uiAmount ?? 0), 0);
}

/** SOL, USDC and (when a mint is configured) Rialto balances of an address, plus where the chain is. */
export async function solStatus(address?: string) {
  const conn = solanaConnection();
  const owner = address ? new PublicKey(address) : getSolanaKeypair().publicKey;
  const [lamports, usdc, slot] = await Promise.all([conn.getBalance(owner), tokenBalance(conn, owner, USDC_MINT), conn.getSlot()]);
  let rialto: number | null = null;
  let mint: string | null = null;
  try {
    const m = resolveMint();
    mint = m.toBase58();
    rialto = await tokenBalance(conn, owner, m);
  } catch {
    /* no mint yet */
  }
  const blockTime = await conn.getBlockTime(slot).catch(() => null);
  return { chain: "solana", rpc: SOLANA_RPC, address: owner.toBase58(), sol: lamports / LAMPORTS_PER_SOL, usdc, rialto, mint, slot, blockTime, explorerUrl: `${SOLANA_EXPLORER}/account/${owner.toBase58()}` };
}


/** Mint facts, the 20 largest token accounts resolved to their owners, and the price from GeckoTerminal when a pool exists. */
export async function solToken(mintIn?: string) {
  const conn = solanaConnection();
  const mint = resolveMint(mintIn);
  const { info, program } = await mintInfo(conn, mint);
  const supply = ui(info.supply, info.decimals);
  let holders: number | null = null;
  let top: OwnerRow[];
  try {
    const scan = await scanHolders(conn, mint, supply, program);
    holders = scan.rows.length;
    top = scan.rows.slice(0, 20);
  } catch {
    top = await largestAccounts(conn, mint, supply).catch(() => []);
  }
  let market: { priceUsd: number | null; fdvUsd: number | null; liquidityUsd: number | null; volume24hUsd: number | null; pool: { name: string; address: string; dex: string } | null } = { priceUsd: null, fdvUsd: null, liquidityUsd: null, volume24hUsd: null, pool: null };
  try {
    const p = await geckoPools(mint.toBase58());
    if (p[0]) market = { priceUsd: num(p[0].attributes.base_token_price_usd), fdvUsd: num(p[0].attributes.fdv_usd), liquidityUsd: num(p[0].attributes.reserve_in_usd), volume24hUsd: num(p[0].attributes.volume_usd?.h24), pool: { name: p[0].attributes.name, address: p[0].attributes.address, dex: p[0].relationships?.dex?.data?.id ?? "" } };
  } catch {
    /* unlisted or rate limited */
  }
  return {
    chain: "solana",
    mint: mint.toBase58(),
    program: program.equals(TOKEN_2022_PROGRAM_ID) ? "token-2022" : "token",
    decimals: info.decimals,
    supply,
    ...burnedSinceLaunch(mint, supply),
    mintAuthority: info.mintAuthority?.toBase58() ?? null,
    freezeAuthority: info.freezeAuthority?.toBase58() ?? null,
    holders,
    top10SharePct: Math.round(top.slice(0, 10).reduce((a, h) => a + h.sharePct, 0) * 100) / 100,
    largest: top,
    ...market,
    explorerUrl: `${SOLANA_EXPLORER}/token/${mint.toBase58()}`,
  };
}

type GtPool = { attributes: { name: string; address: string; base_token_price_usd: string; fdv_usd: string; reserve_in_usd: string; volume_usd?: { h24?: string } }; relationships?: { dex?: { data?: { id: string } } } };
const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
async function gecko<T>(path: string): Promise<T> {
  const res = await fetch(`${GECKO}${path}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
  if (res.status === 429) throw new Error("GeckoTerminal rate limit (30 requests per minute). Retry shortly.");
  if (!res.ok) throw new Error(`GeckoTerminal ${res.status}`);
  return (await res.json()) as T;
}
async function geckoPools(mint: string): Promise<GtPool[]> {
  return (await gecko<{ data: GtPool[] }>(`/networks/solana/tokens/${mint}/pools?page=1`)).data;
}

/**
 * Every wallet holding the mint, by walking the token accounts of the mint (getProgramAccounts). Public endpoints often
 * refuse that call for large mints; the result says whether it is complete or fell back to the 20 largest accounts.
 */
export async function solHolders(mintIn?: string, top = 20) {
  const conn = solanaConnection();
  const mint = resolveMint(mintIn);
  const { info, program } = await mintInfo(conn, mint);
  const supply = ui(info.supply, info.decimals);
  try {
    const { rows, tokenAccounts } = await scanHolders(conn, mint, supply, program);
    return { chain: "solana", mint: mint.toBase58(), complete: true, holders: rows.length, tokenAccounts, top10SharePct: Math.round(rows.slice(0, 10).reduce((a, r) => a + r.sharePct, 0) * 100) / 100, top: rows.slice(0, Math.min(Math.max(1, top), 100)), fetchedAt: new Date().toISOString() };
  } catch (e) {
    const rows = await largestAccounts(conn, mint, supply);
    return { chain: "solana", mint: mint.toBase58(), complete: false, note: `The RPC refused the full token-account scan (${(e as Error).message.slice(0, 80)}); showing the 20 largest accounts. Set SOLANA_RPC_URL to an endpoint that allows getProgramAccounts for a full count.`, holders: null, tokenAccounts: null, top10SharePct: Math.round(rows.slice(0, 10).reduce((a, r) => a + r.sharePct, 0) * 100) / 100, top: rows.slice(0, Math.min(top, 20)), fetchedAt: new Date().toISOString() };
  }
}

export type SolBurn = { signature: string; slot: number; time: string | null; authority: string; amount: number; explorerUrl: string };

/** Burn instructions of the mint found in its most recent transactions (burn and burnChecked, top level and inner). */
export async function solBurns(mintIn?: string, scan = 500) {
  const conn = solanaConnection();
  const mint = resolveMint(mintIn);
  const { info } = await mintInfo(conn, mint);
  const sigs: { signature: string; slot: number; blockTime?: number | null }[] = [];
  let before: string | undefined;
  while (sigs.length < scan) {
    const page = await conn.getSignaturesForAddress(mint, { limit: Math.min(1000, scan - sigs.length), before });
    sigs.push(...page);
    if (page.length < 1000 || page.length === 0) break;
    before = page[page.length - 1].signature;
  }
  const burns: SolBurn[] = [];
  // The public endpoint allows getTransaction only one at a time and not too fast: sequential fetches, a short gap, a retry on 429.
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const fetchOne = async (sig: string): Promise<ParsedTransactionWithMeta | null> => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await conn.getParsedTransaction(sig, { maxSupportedTransactionVersion: 0 });
      } catch (e) {
        const throttled = /429|Too many/i.test((e as Error).message);
        if (!throttled) throw e;
        if (attempt >= 2) throw new Error(`${SOLANA_RPC} throttles getTransaction (HTTP 429) and the burn scan cannot finish there. Set SOLANA_RPC_URL to a free Helius, QuickNode or Triton endpoint, or lower --scan.`);
        await sleep(2000 * (attempt + 1));
      }
    }
  };
  for (let i = 0; i < sigs.length; i += 1) {
    const batch = sigs.slice(i, i + 1);
    const txs = [await fetchOne(batch[0].signature)];
    if (i + 1 < sigs.length) await sleep(120);
    txs.forEach((tx, k) => {
      if (!tx || tx.meta?.err) return;
      for (const ix of allInstructions(tx)) {
        if (!("parsed" in ix) || (ix.program !== "spl-token" && ix.program !== "spl-token-2022")) continue;
        const p = ix.parsed as { type: string; info: { mint?: string; authority?: string; amount?: string; tokenAmount?: { uiAmount?: number | null; amount?: string } } };
        if ((p.type === "burn" || p.type === "burnChecked") && p.info.mint === mint.toBase58()) {
          const raw = p.info.tokenAmount?.amount ?? p.info.amount ?? "0";
          burns.push({ signature: batch[k].signature, slot: batch[k].slot, time: tx.blockTime ? new Date(tx.blockTime * 1000).toISOString() : null, authority: p.info.authority ?? "", amount: ui(BigInt(raw), info.decimals), explorerUrl: `${SOLANA_EXPLORER}/tx/${batch[k].signature}` });
        }
      }
    });
  }
  const total = burns.reduce((a, b) => a + b.amount, 0);
  const supply = ui(info.supply, info.decimals);
  return { chain: "solana", mint: mint.toBase58(), scannedTransactions: sigs.length, complete: sigs.length < scan, count: burns.length, burnedTotal: Math.round(total * 100) / 100, burnedPctOfCurrentSupply: supply ? Math.round((total / supply) * 10000) / 100 : null, ...burnedSinceLaunch(mint, supply), burns };
}

function allInstructions(tx: ParsedTransactionWithMeta): (ParsedInstruction | { programId: PublicKey })[] {
  const top = tx.transaction.message.instructions as (ParsedInstruction | { programId: PublicKey })[];
  const inner = (tx.meta?.innerInstructions ?? []).flatMap((x) => x.instructions as (ParsedInstruction | { programId: PublicKey })[]);
  return [...top, ...inner];
}

/** Recent trades of the mint on its deepest pool, from GeckoTerminal. */
export async function solTrades(mintIn?: string, limit = 40) {
  const mint = resolveMint(mintIn);
  const pools = await geckoPools(mint.toBase58());
  if (!pools[0]) throw new Error(`No pool lists ${mint.toBase58()} on GeckoTerminal yet.`);
  const pool = pools[0].attributes.address;
  type GtTrade = { attributes: { block_timestamp: string; kind: "buy" | "sell"; volume_in_usd: string; tx_hash: string; tx_from_address: string; from_token_amount: string; to_token_amount: string; from_token_address: string; to_token_address: string; price_from_in_usd: string; price_to_in_usd: string } };
  const d = await gecko<{ data: GtTrade[] }>(`/networks/solana/pools/${pool}/trades?trade_volume_in_usd_greater_than=0`);
  const trades = d.data.map(({ attributes: a }) => {
    const toIsMint = a.to_token_address === mint.toBase58();
    return { time: a.block_timestamp, kind: a.kind, usd: Number(a.volume_in_usd), priceUsd: Number(toIsMint ? a.price_to_in_usd : a.price_from_in_usd), tokenAmount: Number(toIsMint ? a.to_token_amount : a.from_token_amount), trader: a.tx_from_address, tx: a.tx_hash, explorerUrl: `${SOLANA_EXPLORER}/tx/${a.tx_hash}` };
  });
  const hourAgo = Date.now() - 3600_000;
  const lastHour = trades.filter((x) => Date.parse(x.time) >= hourAgo);
  const sum = (k: "buy" | "sell") => Math.round(lastHour.filter((x) => x.kind === k).reduce((a, x) => a + x.usd, 0) * 100) / 100;
  return { chain: "solana", mint: mint.toBase58(), pool, label: pools[0].attributes.name, lastPriceUsd: trades[0]?.priceUsd ?? null, lastHour: { trades: lastHour.length, buys: lastHour.filter((x) => x.kind === "buy").length, sells: lastHour.filter((x) => x.kind === "sell").length, buyUsd: sum("buy"), sellUsd: sum("sell") }, trades: trades.slice(0, limit) };
}

/** Burn Rialto (or any SPL mint) from this wallet: a BurnChecked instruction, the supply shrinks for good. Irreversible. */
export async function burnSpl(amount: number, mintIn?: string) {
  const conn = solanaConnection();
  const kp = getSolanaKeypair();
  const mint = resolveMint(mintIn);
  const { info, program } = await mintInfo(conn, mint);
  const ata = await getAssociatedTokenAddress(mint, kp.publicKey, false, program);
  const raw = BigInt(Math.round(amount * 10 ** info.decimals));
  const tx = new Transaction().add(createBurnCheckedInstruction(ata, mint, kp.publicKey, raw, info.decimals, [], program));
  const signature = await sendAndConfirmTransaction(conn, tx, [kp], { commitment: "confirmed" });
  return { chain: "solana", signature, mint: mint.toBase58(), from: kp.publicKey.toBase58(), amount, explorerUrl: `${SOLANA_EXPLORER}/tx/${signature}` };
}

/** Tokenized stocks on Solana (xStocks: AAPLx, TSLAx, NVDAx...): the deepest pool for a symbol, from GeckoTerminal search. */
export async function solStock(symbol: string) {
  const q = symbol.toUpperCase().endsWith("X") ? symbol.toUpperCase() : `${symbol.toUpperCase()}x`;
  const d = await gecko<{ data: { attributes: { name: string; address: string; base_token_price_usd: string; reserve_in_usd: string; volume_usd?: { h24?: string } }; relationships: { base_token: { data: { id: string } }; dex?: { data?: { id: string } } } }[] }>(`/search/pools?query=${encodeURIComponent(q)}&network=solana`);
  const hits = d.data.filter((p) => p.attributes.name.toUpperCase().startsWith(q + " /") || p.attributes.name.toUpperCase().startsWith(q + "/"));
  if (!hits.length) throw new Error(`No Solana pool found for ${q}. xStocks symbols end with x (AAPLx, TSLAx, NVDAx).`);
  const best = hits.sort((a, b) => Number(b.attributes.reserve_in_usd) - Number(a.attributes.reserve_in_usd))[0];
  return { chain: "solana", symbol: q, mint: best.relationships.base_token.data.id.replace("solana_", ""), priceUsd: num(best.attributes.base_token_price_usd), liquidityUsd: num(best.attributes.reserve_in_usd), volume24hUsd: num(best.attributes.volume_usd?.h24), pool: { name: best.attributes.name, address: best.attributes.address, dex: best.relationships.dex?.data?.id ?? "" }, explorerUrl: `${SOLANA_EXPLORER}/token/${best.relationships.base_token.data.id.replace("solana_", "")}` };
}

/** Send SOL from this wallet. Irreversible. */
export async function sendSol(to: string, amount: number) {
  const conn = solanaConnection();
  const kp = getSolanaKeypair();
  const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: new PublicKey(to), lamports: Math.round(amount * LAMPORTS_PER_SOL) }));
  const signature = await sendAndConfirmTransaction(conn, tx, [kp], { commitment: "confirmed" });
  return { chain: "solana", signature, from: kp.publicKey.toBase58(), to, amount, asset: "SOL", explorerUrl: `${SOLANA_EXPLORER}/tx/${signature}` };
}

/** Send an SPL token (USDC by default, or the Rialto mint with `mint`) from this wallet; creates the recipient's token account if needed. Irreversible. */
export async function sendSpl(to: string, amount: number, mintIn?: string) {
  const conn = solanaConnection();
  const kp = getSolanaKeypair();
  const mint = mintIn ? new PublicKey(mintIn) : USDC_MINT;
  const { info, program } = await mintInfo(conn, mint);
  const dest = new PublicKey(to);
  const [fromAta, toAta] = await Promise.all([getAssociatedTokenAddress(mint, kp.publicKey, false, program), getAssociatedTokenAddress(mint, dest, true, program)]);
  const raw = BigInt(Math.round(amount * 10 ** info.decimals));
  const tx = new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(kp.publicKey, toAta, dest, mint, program),
    createTransferCheckedInstruction(fromAta, mint, toAta, kp.publicKey, raw, info.decimals, [], program),
  );
  const signature = await sendAndConfirmTransaction(conn, tx, [kp], { commitment: "confirmed" });
  return { chain: "solana", signature, from: kp.publicKey.toBase58(), to, amount, asset: mint.equals(USDC_MINT) ? "USDC" : mint.toBase58(), explorerUrl: `${SOLANA_EXPLORER}/tx/${signature}` };
}
