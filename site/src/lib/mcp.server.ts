/**
 * Hosted, stateless MCP server (Streamable HTTP, JSON responses) exposing the read-only Robinhood Chain tools.
 * Any MCP client can point at POST /mcp with no install and no key. Writes and Venice inference live in the
 * local rialto-kit package, where the wallet is.
 */
import { accessHeaders, describeAccess, isLimited, limitMessage, requireTier, resolveAccess, type Access } from "./access.server";
import { balances, chainStatus, leaderboard, portfolio, pulse, recentTrades, rialtoBalance, stockFind, stockPrice, flywheel, tokenBurns, tokenCheck, tokenHistory, tokenHolders, tokenOhlcv, tokenStats, tokenSupply, tokenVolume, topPools, usdgTransfers, walletRank, walletReport } from "./hood.server";
import { TOKEN_CA } from "./site";
import { status } from "./status.server";
import { TIERS, tierFor } from "./tiers";

type JsonRpc = { jsonrpc: "2.0"; id?: number | string | null; method: string; params?: Record<string, unknown> };

const PROTOCOL = "2025-06-18";

export const TOOLS = [
  { name: "hood_chain_status", description: "Robinhood Chain status: chain id, latest block, gas price, USDG total supply, and measured vitals (blocks per second, average block time, fee of one token transfer in ETH and USD).", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "hood_balances", description: "ETH and USDG balances of an address on Robinhood Chain.", inputSchema: { type: "object", properties: { address: { type: "string", description: "0x address" } }, required: ["address"] } },
  { name: "hood_wallet_report", description: "Read-only analysis of a Robinhood Chain wallet: ETH, USDG, tokenized stock holdings, tx count, contract flag.", inputSchema: { type: "object", properties: { address: { type: "string" } }, required: ["address"] } },
  { name: "hood_stock_price", description: "USD price of a tokenized stock on Robinhood Chain (ticker or contract address).", inputSchema: { type: "object", properties: { symbol: { type: "string" } }, required: ["symbol"] } },
  { name: "hood_stock_find", description: "Search official Robinhood stock tokens by ticker: contract, price, liquidity, pool.", inputSchema: { type: "object", properties: { ticker: { type: "string" } }, required: ["ticker"] } },
  { name: "hood_top_pools", description: "Top pools on Robinhood Chain by 24h volume.", inputSchema: { type: "object", properties: { limit: { type: "number" } } } },
  { name: "hood_usdg_transfers", description: "USDG transfers from the last N blocks on Robinhood Chain (default 120, max 400): count, volume, largest, latest, with tx links.", inputSchema: { type: "object", properties: { blocks: { type: "number" }, limit: { type: "number" } } } },
  { name: "hood_recent_trades", description: "Recent trades for RIALTO, AAPL, TSLA, NVDA, any stock ticker or a pool address: buys and sells, USD size, price, last hour totals.", inputSchema: { type: "object", properties: { token: { type: "string", description: "RIALTO, ticker or pool address" }, limit: { type: "number" } }, required: ["token"] } },
  { name: "hood_pulse", description: "One-shot live summary of Robinhood Chain: latest block, USDG flow over the last 120 blocks, Rialto tape.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "rialto_burns", description: "Every burn of the Rialto token, read from the chain: amount, block, time, tx, running total and percent of supply.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "rialto_holders", description: "Rialto holder statistics from the full transfer history: holder count, top holders with share, top-10 concentration.", inputSchema: { type: "object", properties: { top: { type: "number" } } } },
  { name: "rialto_history", description: "Growth of the Rialto token replayed from every transfer: holders, cumulative burned, transfers and wallets ever, day by day since launch, plus the current distribution of wallets by tier bucket.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "rialto_rank", description: "Where a wallet stands on the Rialto ledger: rank among holders, share, tier and distance to the next, wallet number since launch (the Nth wallet ever to hold Rialto), first seen, days held, received, sent, burned, day-one and diamond-hands flags, a badge URL and a ready-to-post share text.", inputSchema: { type: "object", properties: { address: { type: "string", description: "0x address" } }, required: ["address"] } },
  { name: "rialto_leaderboard", description: "Top Rialto holders with rank, share, first day, wallet number, diamond-hands and day-one flags; plus cohort figures: diamond hands, day-one wallets still holding, wallets that exited, median balance.", inputSchema: { type: "object", properties: { limit: { type: "number", description: "rows, default 25, max 100" } } } },
  { name: "rialto_price_history", description: "Hourly candles for the Rialto pool (up to 168 hours) with change and volume over the window.", inputSchema: { type: "object", properties: { hours: { type: "number" } } } },
  { name: "rialto_status", description: "Health of everything Rialto depends on: each Robinhood Chain RPC with block height and lag, GeckoTerminal, Venice, the bridges, the explorer.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "hood_token_check", description: "Check any token contract on Robinhood Chain before touching it: name, symbol, supply, creation date, transfers, holders and top-10 concentration replayed from the logs, burned share, liquidity, and plain-language flags.", inputSchema: { type: "object", properties: { address: { type: "string", description: "0x token contract" } }, required: ["address"] } },
  { name: "rialto_flywheel", description: "The Rialto flywheel, read from the chain: USDG revenue received by the treasury from x402 payments, Rialto bought back and burned by the treasury, treasury balances, pay-per-call prices.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "rialto_token", description: "Rialto token on Robinhood Chain: price, FDV, liquidity, 24h volume, volume since launch across every pool, total, burned and circulating supply.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "rialto_access", description: "Your tier on this server (Free, Holder, Pro), remaining requests, and what each tier unlocks. With an address: the tier that wallet would get from its Rialto balance.", inputSchema: { type: "object", properties: { address: { type: "string", description: "optional 0x address to check" } } } },
  { name: "hood_portfolio", description: "Holder tier. Every asset the kit knows about in a wallet, priced in USD: ETH, USDG, stock tokens, Rialto, with a total.", inputSchema: { type: "object", properties: { address: { type: "string" } }, required: ["address"] } },
  { name: "hood_batch", description: "Pro tier. Run up to 20 tool calls in one request, in parallel. Each item is {tool, args}.", inputSchema: { type: "object", properties: { calls: { type: "array", maxItems: 20, items: { type: "object", properties: { tool: { type: "string" }, args: { type: "object" } }, required: ["tool"] } } }, required: ["calls"] } },
];

/** Tools whose cost or value justifies a tier. Everything else is Free. */
const TIER_OF: Record<string, "Holder" | "Pro"> = { hood_portfolio: "Holder", hood_batch: "Pro" };

async function callTool(name: string, args: Record<string, unknown>, access: Access | null, depth = 0): Promise<unknown> {
  const need = TIER_OF[name];
  if (need && access) requireTier(access, need, `Tool ${name}`);
  switch (name) {
    case "hood_usdg_transfers":
      return usdgTransfers(Number(args.blocks ?? 120), Number(args.limit ?? 40));
    case "hood_recent_trades":
      return recentTrades(String(args.token ?? "RIALTO"), Number(args.limit ?? 40));
    case "hood_pulse":
      return pulse();
    case "rialto_burns":
      return tokenBurns();
    case "rialto_holders":
      return tokenHolders(Number(args.top ?? 10));
    case "rialto_history":
      return tokenHistory();
    case "rialto_rank":
      return walletRank(String(args.address ?? ""));
    case "rialto_leaderboard":
      return leaderboard(Number(args.limit ?? 25));
    case "rialto_price_history":
      return tokenOhlcv(Number(args.hours ?? 24));
    case "rialto_status":
      return status();
    case "hood_token_check":
      return tokenCheck(String(args.address ?? ""));
    case "rialto_flywheel":
      return flywheel();
    case "rialto_token": {
      const [stats, supply, volume] = await Promise.all([tokenStats(TOKEN_CA).catch(() => null), tokenSupply(TOKEN_CA), tokenVolume().catch(() => null)]);
      return { address: TOKEN_CA, chainId: 4663, ...(stats ?? {}), volume, supply };
    }
    case "rialto_access": {
      const addr = typeof args.address === "string" && args.address ? args.address : null;
      if (addr) {
        const b = Number((await rialtoBalance(addr)).balance);
        const t = tierFor(b);
        return { address: addr, rialtoBalance: b, tier: t.name, requestsPerMinute: t.rpm, unlocks: t.unlocks, tiers: TIERS.map((x) => ({ name: x.name, minRialto: x.min, requestsPerMinute: x.rpm })), note: "Tier applies once this wallet signs in: rialto access sign, or https://rialto.casa/explore#access" };
      }
      return access ? describeAccess(access) : { tier: "Free", note: "No request context." };
    }
    case "hood_portfolio":
      return portfolio(String(args.address ?? ""));
    case "hood_batch": {
      if (depth > 0) throw new Error("hood_batch cannot nest");
      const calls = Array.isArray(args.calls) ? (args.calls as { tool?: unknown; args?: unknown }[]) : [];
      if (calls.length === 0 || calls.length > 20) throw new Error("calls must hold 1 to 20 items");
      return Promise.all(
        calls.map(async (c) => {
          const tool = String(c.tool ?? "");
          try {
            return { tool, ok: true, data: await callTool(tool, (c.args as Record<string, unknown>) ?? {}, access, depth + 1) };
          } catch (e) {
            return { tool, ok: false, error: (e as Error).message };
          }
        }),
      );
    }
    case "hood_chain_status":
      return chainStatus();
    case "hood_balances":
      return balances(String(args.address ?? ""));
    case "hood_wallet_report":
      return walletReport(String(args.address ?? ""));
    case "hood_stock_price":
      return stockPrice(String(args.symbol ?? ""));
    case "hood_stock_find":
      return stockFind(String(args.ticker ?? ""));
    case "hood_top_pools":
      return topPools(Number(args.limit ?? 10));
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function result(id: JsonRpc["id"], value: unknown) {
  return { jsonrpc: "2.0", id: id ?? null, result: value };
}
function rpcError(id: JsonRpc["id"], code: number, message: string) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

export async function handleRpc(msg: JsonRpc, access: Access | null = null): Promise<unknown | null> {
  const { id, method, params = {} } = msg;
  switch (method) {
    case "initialize":
      return result(id, {
        protocolVersion: typeof params.protocolVersion === "string" ? params.protocolVersion : PROTOCOL,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "rialto-hosted", version: "0.7.0" },
        instructions: `Read-only Robinhood Chain tools. Tier: ${access?.tier.name ?? "Free"}${access?.address ? ` for ${access.address}` : ""}. Holder and Pro tiers (Rialto token balance) unlock hood_portfolio, hood_batch and higher limits; call rialto_access for details. For payments, Venice inference and the wallet, install rialto-kit locally.`,
      });
    case "notifications/initialized":
    case "notifications/cancelled":
      return null;
    case "ping":
      return result(id, {});
    case "tools/list":
      return result(id, { tools: TOOLS });
    case "tools/call": {
      const name = String(params.name ?? "");
      const args = (params.arguments as Record<string, unknown>) ?? {};
      try {
        const value = await callTool(name, args, access);
        return result(id, { content: [{ type: "text", text: JSON.stringify(value, null, 2) }], isError: false });
      } catch (e) {
        return result(id, { content: [{ type: "text", text: (e as Error).message }], isError: true });
      }
    }
    case "resources/list":
      return result(id, { resources: [] });
    case "prompts/list":
      return result(id, { prompts: [] });
    default:
      return rpcError(id, -32601, `Method not found: ${method}`);
  }
}

export async function handleMcpRequest(request: Request): Promise<Response> {
  const headers = {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type, mcp-session-id, mcp-protocol-version, accept, x-rialto-auth, authorization",
    "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
    "access-control-expose-headers": "mcp-session-id, mcp-protocol-version, x-rialto-tier, x-ratelimit-limit, x-ratelimit-remaining, x-ratelimit-reset",
  };
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (request.method === "GET") {
    const access = await resolveAccess(request, 0);
    return new Response(
      JSON.stringify({ name: "rialto-hosted", transport: "streamable-http", stateless: true, tools: TOOLS.map((t) => t.name), tiers: TIERS.map((t) => ({ name: t.name, minRialto: t.min, requestsPerMinute: t.rpm, unlocks: t.unlocks })), access: describeAccess(access), usage: "POST JSON-RPC 2.0 messages to this URL. Send a signed access token as x-rialto-auth or ?auth= to apply your holder tier." }, null, 2),
      { headers: { ...headers, ...accessHeaders(access) } },
    );
  }
  if (request.method === "DELETE") return new Response(null, { status: 204, headers });
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify(rpcError(null, -32700, "Parse error")), { status: 400, headers });
  }
  const messages = Array.isArray(body) ? (body as JsonRpc[]) : [body as JsonRpc];
  const calls = messages.filter((m) => m.method === "tools/call").length;
  const access = await resolveAccess(request, calls);
  const h = { ...headers, ...accessHeaders(access) };
  if (calls > 0 && isLimited(access)) {
    const errs = messages.map((m) => (m.method === "tools/call" ? rpcError(m.id, -32000, limitMessage(access)) : null));
    const out = (await Promise.all(messages.map((m, i) => errs[i] ?? handleRpc(m, access)))).filter((r) => r !== null);
    return new Response(JSON.stringify(Array.isArray(body) ? out : out[0]), { status: 429, headers: { ...h, "retry-after": String(access.resetSeconds) } });
  }
  const responses = (await Promise.all(messages.map((m) => handleRpc(m, access)))).filter((r) => r !== null);
  if (responses.length === 0) return new Response(null, { status: 202, headers: h });
  return new Response(JSON.stringify(Array.isArray(body) ? responses : responses[0]), { headers: h });
}
