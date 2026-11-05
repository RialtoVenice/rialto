/**
 * Reference agent: Venice inference with tools, a hard USD budget, per-tool caps, and Solana hands.
 * The loop stops when the budget is spent, when the model is done, or after maxSteps.
 * Tools are plain functions from the other modules, so the MCP server and the agent share one implementation.
 *
 * Money guards, all enforced locally before anything is signed:
 *   budgetUsd   hard ceiling for the whole run (inference + payments), measured from Venice's balance header.
 *   toolCaps    per-tool ceilings for the run, e.g. { sol_pay: 0.05, venice: 0.03 }. A tool whose cap is reached
 *               is refused and the model is told why; "venice" caps inference spend on its own.
 *   maxPayment  per-payment ceiling (config maxPaymentUsdg) and payAllowlist, enforced inside the payer.
 */
import { resolveConfig } from "./config.js";
import { solHolders, solStatus, solStock, solToken } from "./solana.js";
import { payFetchSolana } from "./solpay.js";
import { chat, balance as veniceBalance, webSearch, type ChatMessage, type ChatTool, type VeniceAuth, veniceAuth } from "./venice.js";

export const AGENT_TOOLS: ChatTool[] = [
  { type: "function", function: { name: "sol_status", description: "SOL, USDC and Rialto balances of a Solana address (default: the agent's own wallet) and the current slot.", parameters: { type: "object", properties: { address: { type: "string" } } } } },
  { type: "function", function: { name: "sol_token", description: "An SPL mint on Solana (default: the Rialto mint): supply, decimals, authorities, largest accounts, price and pool.", parameters: { type: "object", properties: { mint: { type: "string" } } } } },
  { type: "function", function: { name: "sol_holders", description: "Holders of an SPL mint on Solana (default: the Rialto mint): count, top holders, concentration.", parameters: { type: "object", properties: { mint: { type: "string" }, top: { type: "number" } } } } },
  { type: "function", function: { name: "sol_stock", description: "Tokenized stock on Solana (xStocks: AAPLx, TSLAx, NVDAx or any ticker): mint, USD price, liquidity, deepest pool.", parameters: { type: "object", properties: { symbol: { type: "string" } }, required: ["symbol"] } } },
  { type: "function", function: { name: "sol_pay", description: "Fetch an HTTPS URL and pay in USDC on Solana if it answers 402. Respects the per-payment ceiling, the host allowlist and the per-tool cap.", parameters: { type: "object", properties: { url: { type: "string" }, method: { type: "string" }, body: { type: "string" } }, required: ["url"] } } },
  { type: "function", function: { name: "venice_web_search", description: "Private web search through Venice.", parameters: { type: "object", properties: { query: { type: "string" }, limit: { type: "number" } }, required: ["query"] } } },
];

/** Tools that move money, and how to read the amount they moved. Everything else costs nothing on chain. */
const PAYING_TOOLS = new Set(["sol_pay"]);

export type ToolCaps = Record<string, number>;

/** Parse "sol_pay=0.05,venice=0.03" (or repeated flags) into caps. Unknown names are allowed: they just never match. */
export function parseToolCaps(input: string | string[] | undefined): ToolCaps {
  const caps: ToolCaps = {};
  for (const chunk of (Array.isArray(input) ? input : [input ?? ""]).flatMap((s) => s.split(","))) {
    const [name, v] = chunk.split("=").map((s) => s.trim());
    if (!name || v === undefined) continue;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) throw new Error(`Bad cap "${chunk}": expected tool=usd, e.g. sol_pay=0.05`);
    caps[name] = n;
  }
  return caps;
}

export type ToolContext = { caps: ToolCaps; spentByTool: Record<string, number> };

export async function runTool(name: string, args: Record<string, unknown>, ctx?: ToolContext): Promise<unknown> {
  const cap = ctx?.caps[name];
  const spent = ctx?.spentByTool[name] ?? 0;
  if (cap !== undefined && PAYING_TOOLS.has(name) && spent >= cap) {
    return { error: `Per-tool cap reached: ${name} already spent ${spent.toFixed(4)} of its ${cap} USD cap this run. Not paying.` };
  }
  switch (name) {
    case "sol_status":
      return solStatus(args.address ? String(args.address) : undefined);
    case "sol_token":
      return solToken(args.mint ? String(args.mint) : undefined);
    case "sol_holders":
      return solHolders(args.mint ? String(args.mint) : undefined, Number(args.top ?? 10));
    case "sol_stock":
      return solStock(String(args.symbol));
    case "sol_pay": {
      // The remaining cap becomes this payment's ceiling, so a single call can never overshoot the cap.
      const remaining = cap !== undefined ? Math.max(0, cap - spent) : undefined;
      const r = await payFetchSolana(String(args.url), { method: args.method ? String(args.method) : undefined, body: args.body ? String(args.body) : undefined, maxUsdc: remaining });
      const paid = r.receipt ? Number(r.receipt.amountUsdg) : 0;
      if (ctx) ctx.spentByTool[name] = spent + paid;
      return { status: r.response.status, receipt: r.receipt, paidUsdc: paid, body: r.text.slice(0, 4000) };
    }
    case "venice_web_search":
      return webSearch(String(args.query), Number(args.limit ?? 5));
    default:
      throw new Error(`Unknown tool ${name}`);
  }
}

export type AgentEvent =
  | { type: "step"; step: number; content: string }
  | { type: "tool"; name: string; args: Record<string, unknown>; result: unknown; ms: number }
  | { type: "budget"; spentUsd: number; budgetUsd: number; balanceUsd: number | null }
  | { type: "cap"; tool: string; spentUsd: number; capUsd: number }
  | { type: "done"; answer: string; spentUsd: number; steps: number }
  | { type: "stop"; reason: string };

export type AgentOptions = { budgetUsd?: number; toolCaps?: ToolCaps; maxSteps?: number; model?: string; webSearch?: boolean; auth?: VeniceAuth; onEvent?: (e: AgentEvent) => void };

export type AgentResult = { answer: string; spentUsd: number; steps: number; spentByTool: Record<string, number> };

const SYSTEM = `You are Rialto, an agent that lives on Solana and thinks with Venice AI.
You hold USDC in your own wallet and pay for what you use. Be precise, cite numbers you fetched, never invent prices.
Use tools for anything on chain. If a tool answers with an error about a cap or ceiling, do not retry it: say so and finish with what you have.
Keep answers short and factual. When done, answer the user directly.`;

/** Run a goal with a hard budget and per-tool caps. Spend is measured from Venice's X-Balance-Remaining header (wallet mode) or estimated from usage (API key mode). */
export async function runAgent(goal: string, opts: AgentOptions = {}): Promise<AgentResult> {
  const cfg = resolveConfig();
  const budgetUsd = opts.budgetUsd ?? cfg.agentBudgetUsd;
  const caps: ToolCaps = { ...(cfg.toolCaps ?? {}), ...(opts.toolCaps ?? {}) };
  const ctx: ToolContext = { caps, spentByTool: {} };
  const maxSteps = opts.maxSteps ?? 8;
  const auth = opts.auth ?? veniceAuth();
  const emit = opts.onEvent ?? (() => {});
  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM },
    { role: "user", content: goal },
  ];
  const empty = (): AgentResult => ({ answer: "", spentUsd: 0, steps: 0, spentByTool: ctx.spentByTool });

  let startBalance: number | null = null;
  if (auth.kind === "wallet") {
    try {
      const b = await veniceBalance(auth);
      startBalance = b.balanceUsd + (b.diemBalanceUsd ?? 0);
      if (!b.canConsume) {
        emit({ type: "stop", reason: `Venice balance is ${b.balanceUsd} USD and cannot consume. Run \`rialto sol fund 5\` first.` });
        return empty();
      }
    } catch (e) {
      emit({ type: "stop", reason: `Could not read Venice balance: ${(e as Error).message}` });
      return empty();
    }
  }

  let inferenceUsd = 0;
  let steps = 0;
  let lastBalance: number | null = startBalance;
  const paidUsd = () => Object.values(ctx.spentByTool).reduce((a, b) => a + b, 0);
  const totalUsd = () => inferenceUsd + paidUsd();
  for (let step = 1; step <= maxSteps; step++) {
    steps = step;
    const res = await chat(messages, { model: opts.model, tools: AGENT_TOOLS, webSearch: opts.webSearch ? "auto" : "off", auth });
    if (res.balanceRemainingUsd !== null && startBalance !== null) {
      lastBalance = res.balanceRemainingUsd;
      inferenceUsd = Math.max(0, startBalance - res.balanceRemainingUsd);
    } else if (res.usage) {
      inferenceUsd += (res.usage.prompt_tokens * 0.5 + res.usage.completion_tokens * 2) / 1_000_000;
    }
    ctx.spentByTool.venice = inferenceUsd;
    emit({ type: "budget", spentUsd: totalUsd(), budgetUsd, balanceUsd: lastBalance });
    if (totalUsd() >= budgetUsd) {
      emit({ type: "stop", reason: `Budget of ${budgetUsd} USD reached after ${step} steps.` });
      return { answer: res.content, spentUsd: totalUsd(), steps, spentByTool: ctx.spentByTool };
    }
    if (caps.venice !== undefined && inferenceUsd >= caps.venice) {
      emit({ type: "cap", tool: "venice", spentUsd: inferenceUsd, capUsd: caps.venice });
      emit({ type: "stop", reason: `Inference cap of ${caps.venice} USD reached after ${step} steps.` });
      return { answer: res.content, spentUsd: totalUsd(), steps, spentByTool: ctx.spentByTool };
    }
    if (res.toolCalls.length === 0) {
      emit({ type: "done", answer: res.content, spentUsd: totalUsd(), steps });
      return { answer: res.content, spentUsd: totalUsd(), steps, spentByTool: ctx.spentByTool };
    }
    emit({ type: "step", step, content: res.content });
    messages.push({ role: "assistant", content: res.content || null, tool_calls: res.toolCalls });
    for (const call of res.toolCalls) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.function.arguments || "{}");
      } catch {
        args = {};
      }
      const t0 = Date.now();
      let result: unknown;
      try {
        result = await runTool(call.function.name, args, ctx);
      } catch (e) {
        result = { error: (e as Error).message };
      }
      emit({ type: "tool", name: call.function.name, args, result, ms: Date.now() - t0 });
      const name = call.function.name;
      if (caps[name] !== undefined && PAYING_TOOLS.has(name)) emit({ type: "cap", tool: name, spentUsd: ctx.spentByTool[name] ?? 0, capUsd: caps[name] });
      messages.push({ role: "tool", tool_call_id: call.id, name, content: JSON.stringify(result).slice(0, 6000) });
      if (totalUsd() >= budgetUsd) {
        emit({ type: "stop", reason: `Budget of ${budgetUsd} USD reached after a payment in step ${step}.` });
        const last = messages.filter((m) => m.role === "assistant").pop();
        return { answer: last?.content ?? "", spentUsd: totalUsd(), steps, spentByTool: ctx.spentByTool };
      }
    }
  }
  emit({ type: "stop", reason: `Reached maxSteps (${maxSteps}).` });
  const last = messages.filter((m) => m.role === "assistant").pop();
  return { answer: last?.content ?? "", spentUsd: totalUsd(), steps, spentByTool: ctx.spentByTool };
}
