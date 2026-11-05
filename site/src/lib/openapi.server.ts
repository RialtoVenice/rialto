/** OpenAPI 3.1 description of the hosted API, generated from one table so it cannot drift from the routes. */
import { TIERS } from "./tiers";

type Ep = { path: string; method?: "get" | "post"; summary: string; tier?: "Holder" | "Pro"; params?: { name: string; in: "path" | "query"; desc: string; required?: boolean }[]; body?: Record<string, unknown> };

export const ENDPOINTS: Ep[] = [
  { path: "/api/chain", summary: "Robinhood Chain status: chain id, latest block, gas price, USDG supply, measured vitals (blocks per second, block time, transfer fee in ETH and USD)" },
  { path: "/api/stocks", summary: "Seed registry of official stock tokens, or search by ticker with ?q=.", params: [{ name: "q", in: "query", desc: "ticker to search" }] },
  { path: "/api/stocks/{symbol}", summary: "USD price of a tokenized stock (ticker or contract).", params: [{ name: "symbol", in: "path", desc: "ticker or 0x address", required: true }] },
  { path: "/api/wallet/{address}", summary: "Wallet report: ETH, USDG, Rialto, stock tokens, tx count, contract flag.", params: [{ name: "address", in: "path", desc: "0x address", required: true }] },
  { path: "/api/portfolio/{address}", summary: "Holder tier. Every known asset priced in USD with a total.", tier: "Holder", params: [{ name: "address", in: "path", desc: "0x address", required: true }] },
  { path: "/api/pools", summary: "Top pools on Robinhood Chain by 24h volume.", params: [{ name: "limit", in: "query", desc: "rows, default 10" }] },
  { path: "/api/token", summary: "Rialto token stats: price, FDV, liquidity, 24h volume, main pool, volume since launch summed over every pool." },
  { path: "/api/token/burns", summary: "Every burn of the Rialto token, from the chain logs." },
  { path: "/api/token/holders", summary: "Holder statistics replayed from the full transfer history.", params: [{ name: "top", in: "query", desc: "top holders to list, default 10" }] },
  { path: "/api/token/history", summary: "Day-by-day growth replayed from every transfer: holders, cumulative burned, transfers, wallets ever; plus the current wallet distribution by tier bucket." },
  { path: "/api/token/wallet/{address}", summary: "Where a wallet stands on the Rialto ledger: rank among holders, share, tier, wallet number since launch, first seen, days held, received, sent, burned, day-one and diamond-hands flags, badge URL, share text.", params: [{ name: "address", in: "path", desc: "0x address", required: true }] },
  { path: "/api/token/leaderboard", summary: "Top Rialto holders with rank, share, first day, wallet number, diamond-hands and day-one flags; cohort figures (diamond hands, day-one wallets still holding, exited, median balance).", params: [{ name: "limit", in: "query", desc: "rows, default 25, max 100" }] },
  { path: "/badge/{address}.svg", summary: "Embeddable SVG badge of a wallet: rank, balance, never-sold and day-one flags. image/svg+xml, not a JSON envelope.", params: [{ name: "address", in: "path", desc: "0x address", required: true }] },
  { path: "/api/token/ohlcv", summary: "Hourly candles for the Rialto pool.", params: [{ name: "hours", in: "query", desc: "2 to 168, default 24" }] },
  { path: "/api/live/pulse", summary: "One-shot live summary: latest block, USDG flow, Rialto tape." },
  { path: "/api/live/transfers", summary: "USDG transfers over the last N blocks: count, volume, largest, latest.", params: [{ name: "blocks", in: "query", desc: "10 to 400, default 120" }, { name: "limit", in: "query", desc: "rows per list" }] },
  { path: "/api/live/trades", summary: "Recent trades for RIALTO, AAPL, TSLA, NVDA, a ticker or a pool.", params: [{ name: "token", in: "query", desc: "RIALTO, ticker or pool address" }, { name: "limit", in: "query", desc: "rows" }] },
  { path: "/api/access", summary: "Your tier from the access token you send (x-rialto-auth, Bearer, or ?auth=)." },
  { path: "/api/access/{address}", summary: "The tier an address would get from its Rialto balance.", params: [{ name: "address", in: "path", desc: "0x address", required: true }] },
  { path: "/api/batch", method: "post", summary: "Pro tier. Up to 20 tool calls in one request.", tier: "Pro", body: { type: "object", properties: { calls: { type: "array", maxItems: 20, items: { type: "object", properties: { tool: { type: "string" }, args: { type: "object" } }, required: ["tool"] } } }, required: ["calls"] } },
  { path: "/api/chat", method: "post", summary: "Forward one Venice chat request signed by the caller's wallet (SIGN-IN-WITH-X). The server keeps nothing.", body: { type: "object", properties: { siwx: { type: "string" }, messages: { type: "array", items: { type: "object", properties: { role: { type: "string" }, content: { type: "string" } } } }, model: { type: "string" }, live: { type: "boolean" }, wallet: { type: "string" }, webSearch: { type: "boolean" } }, required: ["siwx", "messages"] } },
  { path: "/api/check/{address}", summary: "Token check for any contract on Robinhood Chain: identity, supply, age, holders, concentration, liquidity, flags.", params: [{ name: "address", in: "path", desc: "0x token contract", required: true }] },
  { path: "/api/flywheel", summary: "Treasury revenue from x402 payments, Rialto bought back and burned, balances, pay-per-call prices." },
  { path: "/x402/check/{address}", summary: "Pay-per-call token check, 0.02 USDG on Robinhood Chain via x402 (answers 402 with PAYMENT-REQUIRED; send PAYMENT-SIGNATURE).", params: [{ name: "address", in: "path", desc: "0x token contract", required: true }] },
  { path: "/x402/portfolio/{address}", summary: "Pay-per-call portfolio, 0.01 USDG via x402, no Holder tier needed.", params: [{ name: "address", in: "path", desc: "0x address", required: true }] },
  { path: "/x402/pulse", summary: "Pay-per-call live pulse, 0.005 USDG via x402." },
  { path: "/x402/batch", method: "post", summary: "Pay-per-call batch of up to 20 tool calls, 0.05 USDG via x402, no Pro tier needed.", body: { type: "object", properties: { calls: { type: "array", maxItems: 20, items: { type: "object", properties: { tool: { type: "string" }, args: { type: "object" } }, required: ["tool"] } } }, required: ["calls"] } },
  { path: "/api/status", summary: "Health of the RPC pool, GeckoTerminal, Venice, the bridges and the explorer." },
];

export function openapi(origin: string) {
  const paths: Record<string, unknown> = {};
  for (const e of ENDPOINTS) {
    const method = e.method ?? "get";
    paths[e.path] = {
      [method]: {
        summary: e.summary,
        description: e.tier ? `Requires the ${e.tier} tier: hold ${TIERS.find((t) => t.name === e.tier)!.min.toLocaleString("en-US")} Rialto and send a signed access token.` : undefined,
        parameters: (e.params ?? []).map((p) => ({ name: p.name, in: p.in, required: !!p.required, description: p.desc, schema: { type: "string" } })),
        requestBody: e.body ? { required: true, content: { "application/json": { schema: e.body } } } : undefined,
        security: e.tier ? [{ rialtoAuth: [] }] : [],
        responses: {
          "200": { description: "ok", content: { "application/json": { schema: { $ref: "#/components/schemas/Envelope" } } } },
          "400": { description: "error", content: { "application/json": { schema: { $ref: "#/components/schemas/Envelope" } } } },
          ...(e.tier ? { "403": { description: "tier too low" } } : {}),
          "429": { description: "rate limited; see x-ratelimit-* and retry-after headers" },
        },
      },
    };
  }
  return {
    openapi: "3.1.0",
    info: { title: "Rialto hosted API", version: "0.5.0", description: "Read-only Robinhood Chain data, the Rialto token ledger, live feeds and a wallet-signed Venice chat proxy. No key. Holder tiers from the Rialto balance of a signed-in wallet.", contact: { url: `${origin}/docs` }, license: { name: "MIT" } },
    servers: [{ url: origin }],
    paths,
    components: {
      schemas: { Envelope: { type: "object", properties: { ok: { type: "boolean" }, data: {}, error: { type: "string" } }, required: ["ok"] } },
      securitySchemes: { rialtoAuth: { type: "apiKey", in: "header", name: "x-rialto-auth", description: "Base64 JSON {address, issued, signature}: the wallet's signature of the Rialto access message. Get one with `rialto access sign` or at /explore#access. Also accepted as ?auth= on the URL." } },
    },
    "x-tiers": TIERS,
    "x-mcp": { url: `${origin}/mcp`, transport: "streamable-http" },
  };
}
