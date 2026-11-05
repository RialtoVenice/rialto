import { createServerFn } from "@tanstack/react-start";
import { chainStatus, flywheel, leaderboard, pulse, registryPrices, tokenBurns, tokenHistory, tokenHolders, tokenOhlcv, tokenStats, tokenSupply, tokenVolume, topPools, type BurnLedger, type Flywheel, type HolderStats, type Leaderboard, type Ohlcv, type TokenHistory, type TokenVolume } from "./hood.server";
import { requestOrigin } from "./origin.server";
import { TOKEN_CA } from "./site";

export type LiveData = {
  origin: string;
  chain: Awaited<ReturnType<typeof chainStatus>> | null;
  stocks: Awaited<ReturnType<typeof registryPrices>> | null;
  token: Awaited<ReturnType<typeof tokenStats>> | null;
  supply: Awaited<ReturnType<typeof tokenSupply>> | null;
  volume: TokenVolume | null;
  fetchedAt: string;
};

export const getOrigin = createServerFn({ method: "GET" }).handler(async () => requestOrigin());

export const getLive = createServerFn({ method: "GET" }).handler(async (): Promise<LiveData> => {
  const [chain, stocks, token, supply, volume] = await Promise.all([chainStatus().catch(() => null), registryPrices().catch(() => null), tokenStats(TOKEN_CA).catch(() => null), tokenSupply(TOKEN_CA).catch(() => null), tokenVolume().catch(() => null)]);
  return { origin: requestOrigin(), chain, stocks, token, supply, volume, fetchedAt: new Date().toISOString() };
});

export type PoolsData = Awaited<ReturnType<typeof topPools>>;
export const getPools = createServerFn({ method: "GET" }).handler(async (): Promise<PoolsData> => topPools(12).catch(() => []));

export type PulseData = Awaited<ReturnType<typeof pulse>>;
export const getPulse = createServerFn({ method: "GET" }).handler(async (): Promise<PulseData | null> => pulse().catch(() => null));

export type TokenLedger = { burns: BurnLedger | null; holders: HolderStats | null; ohlcv: Ohlcv | null; history: TokenHistory | null; board: Leaderboard | null };
export const getTokenLedger = createServerFn({ method: "GET" }).handler(async (): Promise<TokenLedger> => {
  const [burns, holders, ohlcv, history, board] = await Promise.all([tokenBurns().catch(() => null), tokenHolders(8).catch(() => null), tokenOhlcv(24).catch(() => null), tokenHistory().catch(() => null), leaderboard(20).catch(() => null)]);
  return { burns, holders, ohlcv, history, board };
});

export type FlywheelData = Flywheel;
export const getFlywheel = createServerFn({ method: "GET" }).handler(async (): Promise<FlywheelData | null> => flywheel().catch(() => null));

// ---------------------------------------------------------------------------------------------
// Solana: everything the home page, the live page and the explorer need, in one server call.
// ---------------------------------------------------------------------------------------------
import { solBurns, solChain, solHolders, solLeaderboard, solTokenStats, solTrades } from "./sol.server";
import { SOLANA_MINT } from "./site";

export type SolData = {
  mint: string | null;
  chain: Awaited<ReturnType<typeof solChain>> | null;
  stats: Awaited<ReturnType<typeof solTokenStats>> | null;
  holders: Awaited<ReturnType<typeof solHolders>> | null;
  board: Awaited<ReturnType<typeof solLeaderboard>> | null;
  burns: Awaited<ReturnType<typeof solBurns>> | null;
  trades: Awaited<ReturnType<typeof solTrades>> | null;
  fetchedAt: string;
};

export const getSol = createServerFn({ method: "GET" }).handler(async (): Promise<SolData> => {
  const mint = process.env.RIALTO_SOLANA_MINT || SOLANA_MINT || null;
  const chain = await solChain().catch(() => null);
  if (!mint) return { mint: null, chain, stats: null, holders: null, board: null, burns: null, trades: null, fetchedAt: new Date().toISOString() };
  // Scans can take a while on a cold cache; the page never waits more than a few seconds for any of them.
  // The server keeps computing in the background (the cache stores the result), so the next request has it.
  const soon = <T,>(p: Promise<T>, ms: number): Promise<T | null> => Promise.race([p.catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), ms))]);
  const [stats, holders, board, burns, trades] = await Promise.all([
    soon(solTokenStats(mint), 6_000),
    soon(solHolders(mint, 10), 6_000),
    soon(solLeaderboard(mint, 20), 6_000),
    soon(solBurns(mint, 60), 4_000),
    soon(solTrades(mint, 30), 6_000),
  ]);
  return { mint, chain, stats, holders, board, burns, trades, fetchedAt: new Date().toISOString() };
});
