/**
 * Playground proxy: the browser wallet signs Venice's SIGN-IN-WITH-X message (SIWE, chainId 8453, domain
 * api.venice.ai), the server forwards one chat request with that header and returns the answer. The server holds
 * no key and no credit: every request is paid by the caller's own Venice ledger. Signatures are single use.
 */
import { TOKEN_CA } from "./site";
import { chainStatus, registryPrices, tokenStats, tokenSupply, walletReport } from "./hood.server";

export const VENICE_CHAT_URL = "https://api.venice.ai/api/v1/chat/completions";
export const PLAYGROUND_MODELS = ["zai-org-glm-5-2", "llama-3.3-70b", "qwen3-235b-a22b-instruct-2507", "venice-uncensored", "deepseek-v3.2"];

type Msg = { role: "system" | "user" | "assistant"; content: string };

const SYSTEM = `You are Rialto's playground assistant: a Venice AI model answering from a wallet on Robinhood Chain (chain id 4663, USDG dollar, tokenized stocks). Be concise and factual. When live context is provided, use it and say the figures come from the chain right now. Do not invent prices.`;

export async function liveContext(wallet?: string): Promise<string> {
  const [chain, prices, tok, supply, report] = await Promise.all([
    chainStatus().catch(() => null),
    registryPrices().catch(() => null),
    tokenStats(TOKEN_CA).catch(() => null),
    tokenSupply(TOKEN_CA).catch(() => null),
    wallet ? walletReport(wallet).catch(() => null) : Promise.resolve(null),
  ]);
  const lines: string[] = [`Live context fetched ${new Date().toISOString()}.`];
  if (chain) lines.push(`Robinhood Chain block ${chain.blockNumber}, gas ${Number(chain.gasPriceGwei).toFixed(4)} gwei, USDG supply ${Number(chain.usdgTotalSupply).toLocaleString("en-US", { maximumFractionDigits: 0 })}.`);
  if (prices) lines.push(`Stock tokens (USD): ${prices.map((p) => `${p.symbol} ${p.priceUsd === null ? "n/a" : p.priceUsd.toFixed(2)}`).join(", ")}.`);
  if (tok) lines.push(`Rialto token: price ${tok.priceUsd ?? "n/a"} USD, FDV ${tok.fdvUsd ?? "n/a"} USD, liquidity ${tok.liquidityUsd ?? "n/a"} USD, 24h volume ${tok.volume24hUsd ?? "n/a"} USD.`);
  if (supply) lines.push(`Rialto supply: total ${supply.total}, burned ${supply.burned} (${supply.burnedPct}%), circulating ${supply.circulating}.`);
  if (report) lines.push(`Caller wallet ${report.address}: ${Number(report.eth).toFixed(5)} ETH, ${report.usdg} USDG, ${Number(report.rialto).toLocaleString("en-US", { maximumFractionDigits: 0 })} Rialto, ${report.txCount} txs, stock tokens: ${report.stockTokens.map((s) => `${s.symbol} ${s.balance}`).join(", ") || "none"}.`);
  return lines.join("\n");
}

export async function proxyChat(input: { siwx: string; messages: Msg[]; model?: string; live?: boolean; wallet?: string; webSearch?: boolean }) {
  const model = PLAYGROUND_MODELS.includes(input.model ?? "") ? input.model! : PLAYGROUND_MODELS[0];
  const msgs = input.messages.filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string").slice(-12);
  if (msgs.length === 0) throw new Error("messages is empty");
  const system = input.live ? `${SYSTEM}\n\n${await liveContext(input.wallet)}` : SYSTEM;
  const body: Record<string, unknown> = { model, messages: [{ role: "system", content: system }, ...msgs], max_tokens: 700, temperature: 0.4 };
  if (input.webSearch) body.venice_parameters = { enable_web_search: "on", enable_web_citations: true };
  const res = await fetch(VENICE_CHAT_URL, { method: "POST", headers: { "content-type": "application/json", "SIGN-IN-WITH-X": input.siwx }, body: JSON.stringify(body), signal: AbortSignal.timeout(60_000) });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    /* keep text */
  }
  const balance = res.headers.get("x-balance-remaining");
  if (!res.ok) {
    const err = typeof json.error === "string" ? json.error : typeof json.error === "object" && json.error ? JSON.stringify(json.error) : text.slice(0, 300);
    return { ok: false as const, status: res.status, error: err, balanceRemainingUsd: balance ? Number(balance) : null, needsCredit: res.status === 402 || /balance|credit|top.?up|insufficient/i.test(err) };
  }
  const choice = (json.choices as { message?: { content?: string } }[] | undefined)?.[0];
  const usage = json.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined;
  const citations = ((json.venice_parameters as { web_search_citations?: { url: string; title?: string }[] } | undefined)?.web_search_citations ?? []).slice(0, 6);
  return { ok: true as const, model, content: choice?.message?.content ?? "", usage, citations, balanceRemainingUsd: balance ? Number(balance) : null };
}
