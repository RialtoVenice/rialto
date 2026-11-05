/**
 * Rialto MCP server (stdio). Works with Claude Desktop, Claude Code, Cursor, Hermes, OpenClaw and any MCP client.
 * Tools mirror the reference agent's tools plus wallet management, Venice chat and the USDG-to-Venice bridge.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { accessTier, signAccess } from "./access.js";
import { burnRialto, chainVitals, flywheel, pulse, recentTrades, rialtoBurns, rialtoHistory, rialtoHolders, rialtoToken, tokenCheck, usdgTransfers, rialtoBadge, rialtoLeaderboard, rialtoRank, watch } from "./feeds.js";
import { runAgent } from "./agent.js";
import { fundVenice, bestQuote } from "./bridge.js";
import { resolveConfig } from "./config.js";
import { analyzeWallet, balances, chainStatus, sendUsdg } from "./hood.js";
import { findStock, stockPrice, topPools } from "./stocks.js";
import { balance as veniceBalance, chat, listModels, transactions, webSearch } from "./venice.js";
import { getAccount } from "./wallet.js";
import { burnSpl, sendSpl, solBurns, solHolders, solStatus, solStock, solToken, solTrades } from "./solana.js";
import { payFetchSolana, topUpSolana } from "./solpay.js";
import { payFetch } from "./x402.js";

function text(v: unknown) {
  return { content: [{ type: "text" as const, text: typeof v === "string" ? v : JSON.stringify(v, null, 2) }] };
}

async function guarded<T>(fn: () => Promise<T>) {
  try {
    return text(await fn());
  } catch (e) {
    return { ...text({ error: (e as Error).message }), isError: true };
  }
}

export function buildServer(): McpServer {
  const server = new McpServer({ name: "rialto", version: "0.1.0" });

  server.registerTool("rialto_wallet", { description: "The Rialto wallet address plus ETH and USDG balances on Robinhood Chain and the Venice credit balance.", inputSchema: {} }, async () =>
    guarded(async () => {
      const account = getAccount();
      const hood = await balances(account.address);
      let venice: unknown = null;
      try {
        venice = await veniceBalance();
      } catch (e) {
        venice = { error: (e as Error).message };
      }
      return { address: account.address, robinhoodChain: hood, venice };
    }),
  );

  server.registerTool("hood_chain_status", { description: "Robinhood Chain status: chain id, latest block, gas price, USDG supply.", inputSchema: {} }, async () => guarded(chainStatus));

  server.registerTool("rialto_access", { description: "Holder tier of the hosted Rialto API and MCP for an address (default: this wallet): Rialto balance, tier, limits, what it unlocks.", inputSchema: { address: z.string().optional().describe("0x address, default this wallet") } }, async ({ address }) =>
    guarded(() => accessTier(address)),
  );
  server.registerTool("rialto_access_sign", { description: "Sign a 24 hour access token with this wallet for the hosted API and MCP at rialto.casa. Free, no gas, nothing moves. Returns the token, header and an MCP URL.", inputSchema: {} }, async () =>
    guarded(() => signAccess()),
  );

  server.registerTool("rialto_burn", { description: "Send Rialto from this wallet to the dead address. IRREVERSIBLE: confirm with the user first. Every 10,000 burned buys 24 hours of Pro on the hosted API for this wallet.", inputSchema: { amount: z.string().describe("whole Rialto tokens, e.g. 10000") } }, async ({ amount }) =>
    guarded(() => burnRialto(amount)),
  );
  server.registerTool("rialto_flywheel", { description: "x402 revenue received by the Rialto treasury, Rialto bought back and burned, treasury balances, pay-per-call prices.", inputSchema: {} }, async () =>
    guarded(() => flywheel()),
  );
  server.registerTool("rialto_token", { description: "Rialto token on Robinhood Chain: price, FDV, liquidity, 24h volume, volume since launch across every pool that lists it.", inputSchema: {} }, async () =>
    guarded(() => rialtoToken()),
  );
  server.registerTool("rialto_burns", { description: "Every burn of the Rialto token, read from the chain: amount, block, time, tx, running total and percent of supply.", inputSchema: {} }, async () =>
    guarded(() => rialtoBurns()),
  );
  server.registerTool("rialto_holders", { description: "Rialto holder count, top holders with share, top-10 concentration, and the block the figures are current to.", inputSchema: { top: z.number().optional() } }, async ({ top }) =>
    guarded(() => rialtoHolders(top ?? 10)),
  );
  server.registerTool("rialto_history", { description: "Growth of the Rialto token day by day since launch, replayed from every transfer: holders, cumulative burned, transfers, wallets ever; plus the current wallet distribution by tier bucket.", inputSchema: {} }, async () =>
    guarded(() => rialtoHistory()),
  );
  server.registerTool("rialto_rank", { description: "Where a wallet stands on the Rialto ledger: rank among holders, share, tier and distance to the next, wallet number since launch, first seen, days held, received, sent, burned, day-one and never-sold flags, badge URL, share text. Default: this wallet.", inputSchema: { address: z.string().optional() } }, async ({ address }) =>
    guarded(() => rialtoRank(address ?? getAccount().address)),
  );
  server.registerTool("rialto_watch_once", { description: "One pass of the chain watcher: the latest block, USDG flow over the last 120 blocks, the current Rialto tape, the burn count, and (with a wallet, default this one) its balances and rank. Same events as `rialto watch --once --json`; call it again later to see what changed.", inputSchema: { wallet: z.string().optional() } }, async ({ wallet }) =>
    guarded(async () => {
      const w = (wallet ?? getAccount().address) as `0x${string}`;
      const events: unknown[] = [];
      for await (const ev of watch({ wallet: w, once: true })) events.push(ev);
      return { at: new Date().toISOString(), wallet: w, events };
    }),
  );
  server.registerTool("rialto_compare", { description: "Two wallets side by side on the Rialto ledger: rank, balance, tier, wallet number since launch, first day, days held, received, sent, burned, never-sold and day-one flags.", inputSchema: { a: z.string(), b: z.string() } }, async ({ a, b }) =>
    guarded(async () => { const [x, y] = await Promise.all([rialtoRank(a), rialtoRank(b)]); return { a: x, b: y }; }),
  );
  server.registerTool("sol_status", { description: "Rialto on Solana: SOL, USDC and Rialto balances of an address (default: this install's Solana wallet), current slot.", inputSchema: { address: z.string().optional() } }, async ({ address }) =>
    guarded(() => solStatus(address)),
  );
  server.registerTool("sol_token", { description: "An SPL mint on Solana (default: the configured Rialto mint): supply, decimals, authorities, the 20 largest accounts with owners, price and pool.", inputSchema: { mint: z.string().optional() } }, async ({ mint }) =>
    guarded(() => solToken(mint)),
  );
  server.registerTool("sol_holders", { description: "Holders of an SPL mint on Solana (default: the Rialto mint): full scan when the RPC allows it, else the 20 largest; top holders and concentration.", inputSchema: { mint: z.string().optional(), top: z.number().optional() } }, async ({ mint, top }) =>
    guarded(() => solHolders(mint, top ?? 20)),
  );
  server.registerTool("sol_burns", { description: "Burns of an SPL mint on Solana (default: the Rialto mint), found in its recent transactions: amount, authority, time, signature, total.", inputSchema: { mint: z.string().optional(), scan: z.number().optional() } }, async ({ mint, scan }) =>
    guarded(() => solBurns(mint, scan ?? 100)),
  );
  server.registerTool("sol_trades", { description: "Recent trades of an SPL mint on Solana (default: the Rialto mint) on its deepest pool: buys and sells, USD size, price, last hour totals.", inputSchema: { mint: z.string().optional(), limit: z.number().optional() } }, async ({ mint, limit }) =>
    guarded(() => solTrades(mint, limit ?? 40)),
  );
  server.registerTool("sol_stock", { description: "Tokenized stock on Solana (xStocks: AAPLx, TSLAx, NVDAx...): mint, USD price, liquidity, deepest pool.", inputSchema: { symbol: z.string() } }, async ({ symbol }) =>
    guarded(() => solStock(symbol)),
  );
  server.registerTool("sol_pay", { description: "Fetch an HTTPS URL and pay in USDC on Solana if it answers 402 with a Solana x402 option. Respects the per-payment ceiling and the host allowlist. Use dryRun to see the price first.", inputSchema: { url: z.string(), method: z.string().optional(), body: z.string().optional(), dryRun: z.boolean().optional() } }, async ({ url, method, body, dryRun }) =>
    guarded(async () => { const r = await payFetchSolana(url, { method, body, dryRun }); return { status: r.response.status, receipt: r.receipt ?? null, requirement: r.requirement ?? null, body: r.text.slice(0, 4000) }; }),
  );
  server.registerTool("sol_fund", { description: "Top up Venice from this wallet's USDC on Solana (minimum 5 USD). Moves money: confirm with the user first.", inputSchema: { amountUsd: z.number() } }, async ({ amountUsd }) =>
    guarded(() => topUpSolana(amountUsd)),
  );
  server.registerTool("sol_send", { description: "Send USDC (default) or an SPL mint from this Solana wallet. IRREVERSIBLE: confirm with the user first.", inputSchema: { to: z.string(), amount: z.number(), mint: z.string().optional() } }, async ({ to, amount, mint }) =>
    guarded(() => sendSpl(to, amount, mint)),
  );
  server.registerTool("sol_burn", { description: "Burn Rialto on Solana from this wallet. IRREVERSIBLE: confirm with the user first.", inputSchema: { amount: z.number(), mint: z.string().optional() } }, async ({ amount, mint }) =>
    guarded(() => burnSpl(amount, mint)),
  );
  server.registerTool("rialto_badge", { description: "Badge of a wallet from rialto.casa: URL, Markdown snippet for a README, and the SVG text. Default: this wallet.", inputSchema: { address: z.string().optional() } }, async ({ address }) =>
    guarded(() => rialtoBadge(address ?? getAccount().address)),
  );
  server.registerTool("rialto_share", { description: "Share text of a wallet (rank, wallet number since launch, never sold, day one) and the X post link that carries it. Default: this wallet.", inputSchema: { address: z.string().optional() } }, async ({ address }) =>
    guarded(async () => { const r = await rialtoRank(address ?? getAccount().address); return { shareText: r.shareText, shareUrl: r.shareUrl, rank: r.rank, walletNo: r.walletNo, diamond: r.diamond, dayOne: r.dayOne }; }),
  );
  server.registerTool("rialto_leaderboard", { description: "Top Rialto holders with rank, share, first day, wallet number, never-sold and day-one flags; cohort figures: diamond hands, day-one wallets still holding, exited, median balance.", inputSchema: { limit: z.number().optional() } }, async ({ limit }) =>
    guarded(() => rialtoLeaderboard(limit ?? 25)),
  );
  server.registerTool("hood_chain_vitals", { description: "Measured Robinhood Chain vitals: blocks per second over the last 2,000 blocks, average block time, fee of one token transfer in ETH and USD.", inputSchema: {} }, async () =>
    guarded(() => chainVitals()),
  );
  server.registerTool("hood_pulse", { description: "One-shot live summary of Robinhood Chain: latest block, USDG flow over the last 120 blocks, Rialto price and tape.", inputSchema: {} }, async () =>
    guarded(() => pulse()),
  );
  server.registerTool("hood_token_check", { description: "Check any token contract on Robinhood Chain before touching it: identity, supply, creation date, holders and concentration replayed from its logs, liquidity, plain flags.", inputSchema: { address: z.string().describe("0x token contract") } }, async ({ address }) =>
    guarded(() => tokenCheck(address)),
  );
  server.registerTool("hood_usdg_transfers", { description: "USDG transfers from the last N blocks on Robinhood Chain (default 120, max 400): count, volume, largest, latest, with tx links.", inputSchema: { blocks: z.number().optional(), limit: z.number().optional() } }, async ({ blocks, limit }) =>
    guarded(() => usdgTransfers(blocks ?? 120, limit ?? 40)),
  );
  server.registerTool("hood_recent_trades", { description: "Recent trades for RIALTO, AAPL, TSLA, NVDA or any official stock ticker: buys and sells, USD size, price, last hour totals.", inputSchema: { token: z.string().optional().describe("RIALTO (default), ticker"), limit: z.number().optional() } }, async ({ token, limit }) =>
    guarded(() => recentTrades(token ?? "RIALTO", limit ?? 40)),
  );

  server.registerTool("hood_balances", { description: "ETH and USDG balances of any address on Robinhood Chain.", inputSchema: { address: z.string().describe("0x address") } }, async ({ address }) =>
    guarded(() => balances(address as `0x${string}`)),
  );

  server.registerTool("hood_wallet_report", { description: "Read-only analysis of a Robinhood Chain wallet: ETH, USDG, tokenized stock holdings, tx count, contract flag.", inputSchema: { address: z.string() } }, async ({ address }) =>
    guarded(() => analyzeWallet(address)),
  );

  server.registerTool("hood_stock_price", { description: "USD price of a tokenized stock on Robinhood Chain by ticker or contract address.", inputSchema: { symbol: z.string() } }, async ({ symbol }) => guarded(() => stockPrice(symbol)));

  server.registerTool("hood_stock_find", { description: "Search official Robinhood stock tokens by ticker: contract, price, liquidity, pool.", inputSchema: { ticker: z.string() } }, async ({ ticker }) => guarded(() => findStock(ticker)));

  server.registerTool("hood_top_pools", { description: "Top pools on Robinhood Chain by 24h volume.", inputSchema: { limit: z.number().int().min(1).max(50).optional() } }, async ({ limit }) => guarded(() => topPools(limit ?? 10)));

  server.registerTool(
    "hood_send_usdg",
    { description: "Send USDG from the Rialto wallet on Robinhood Chain. Irreversible. Needs a little ETH for gas.", inputSchema: { to: z.string(), amount: z.string().describe("USDG amount, e.g. 1.50") } },
    async ({ to, amount }) => guarded(() => sendUsdg(to, amount)),
  );

  server.registerTool(
    "x402_pay",
    {
      description: "Fetch an HTTPS URL and pay in USDG on Robinhood Chain if it answers 402 (x402 v1 or v2, exact scheme). Enforces the per-payment ceiling and allowlist from the Rialto config.",
      inputSchema: { url: z.string().url(), method: z.string().optional(), body: z.string().optional(), dryRun: z.boolean().optional().describe("Only read the payment requirements, do not pay") },
    },
    async ({ url, method, body, dryRun }) =>
      guarded(async () => {
        const r = await payFetch(url, { method, body, dryRun });
        return { status: r.response.status, requirement: r.requirement, receipt: r.receipt, body: r.text.slice(0, 8000) };
      }),
  );

  server.registerTool(
    "venice_chat",
    { description: "Ask a Venice AI model (private, uncensored) a question. Paid from the wallet's Venice credit or the API key.", inputSchema: { prompt: z.string(), model: z.string().optional(), webSearch: z.boolean().optional() } },
    async ({ prompt, model, webSearch: ws }) =>
      guarded(async () => {
        const r = await chat([{ role: "user", content: prompt }], { model, webSearch: ws ? "auto" : "off" });
        return { content: r.content, model: r.model, balanceRemainingUsd: r.balanceRemainingUsd, citations: r.citations };
      }),
  );

  server.registerTool("venice_web_search", { description: "Private web search through Venice.", inputSchema: { query: z.string(), limit: z.number().int().min(1).max(20).optional() } }, async ({ query, limit }) =>
    guarded(() => webSearch(query, limit ?? 5)),
  );

  server.registerTool("venice_models", { description: "List Venice text models with traits and pricing.", inputSchema: {} }, async () =>
    guarded(async () => (await listModels("text")).map((m) => ({ id: m.id, traits: m.model_spec?.traits, pricing: m.model_spec?.pricing }))),
  );

  server.registerTool("venice_balance", { description: "Venice x402 credit balance for the Rialto wallet.", inputSchema: {} }, async () => guarded(veniceBalance));

  server.registerTool("venice_transactions", { description: "Recent Venice ledger entries for the Rialto wallet.", inputSchema: { limit: z.number().int().min(1).max(100).optional() } }, async ({ limit }) => guarded(() => transactions(limit ?? 20)));

  server.registerTool(
    "rialto_quote_bridge",
    { description: "Quote moving USDG from Robinhood Chain to USDC on Base through Relay (no transaction).", inputSchema: { amountUsdg: z.string() } },
    async ({ amountUsdg }) =>
      guarded(async () => {
        const q = await bestQuote(amountUsdg, getAccount().address);
        return { provider: q.provider, expectedUsdc: q.expectedUsdc, timeEstimateSeconds: q.timeEstimateSeconds };
      }),
  );

  server.registerTool(
    "rialto_fund_venice",
    { description: "Bridge USDG from Robinhood Chain to USDC on Base and top up the wallet's Venice credit. Moves real funds. Minimum 5 USDG.", inputSchema: { amountUsdg: z.string() } },
    async ({ amountUsdg }) =>
      guarded(async () => {
        const log: string[] = [];
        const r = await fundVenice(amountUsdg, (m) => log.push(m));
        return { ...r, log };
      }),
  );

  server.registerTool(
    "rialto_agent",
    { description: "Run the budgeted Rialto reference agent on a goal (Venice reasoning + Solana tools + USDC x402 payments). toolCaps sets per-tool USD caps for the run, e.g. { sol_pay: 0.05, venice: 0.03 }.", inputSchema: { goal: z.string(), budgetUsd: z.number().positive().optional(), toolCaps: z.record(z.string(), z.number().nonnegative()).optional(), maxSteps: z.number().int().min(1).max(20).optional() } },
    async ({ goal, budgetUsd, toolCaps, maxSteps }) =>
      guarded(async () => {
        const events: unknown[] = [];
        const r = await runAgent(goal, { budgetUsd, toolCaps, maxSteps, onEvent: (e) => events.push(e) });
        return { ...r, events };
      }),
  );

  server.registerResource("rialto-config", "rialto://config", { description: "Effective Rialto configuration (secrets redacted)." }, async (uri) => {
    const cfg = resolveConfig();
    return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify({ ...cfg, privateKey: cfg.privateKey ? "(set)" : undefined, veniceApiKey: cfg.veniceApiKey ? "(set)" : undefined }, null, 2) }] };
  });

  return server;
}

export async function serveStdio(): Promise<void> {
  const server = buildServer();
  await server.connect(new StdioServerTransport());
}
