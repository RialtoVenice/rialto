/**
 * Local ledger of every payment the kit signs: x402 payments on Solana and Venice top-ups.
 * One JSON line per payment in ~/.rialto/receipts.jsonl (mode 600). Written by the payer itself,
 * so the CLI, the MCP server and the agent all leave the same trail. Nothing is uploaded anywhere.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { RIALTO_HOME } from "./config.js";

export const RECEIPTS_PATH = join(RIALTO_HOME, "receipts.jsonl");

export type Receipt = {
  at: string;
  kind: "x402" | "topup";
  url: string;
  host: string;
  amountUsdc: number;
  /** HTTP status of the paid request. Below 400 means the endpoint accepted the payment. */
  status: number;
  /** Solana transaction signature reported by the facilitator, when it reports one. */
  signature: string | null;
  /** Provider-side reference (Venice payment id for top-ups). */
  ref?: string | null;
  payTo?: string;
  network?: string;
  /** Ceiling that applied to this payment (per-payment or remaining per-tool cap). */
  cap?: number | null;
};

/** Pull a transaction signature out of an x402 settlement header, whatever its shape. */
export function settlementSignature(settlement: unknown): string | null {
  if (!settlement || typeof settlement !== "object") return null;
  const s = settlement as Record<string, unknown>;
  for (const k of ["transaction", "txHash", "signature"]) if (typeof s[k] === "string" && (s[k] as string).length > 20) return s[k] as string;
  return null;
}

export function recordReceipt(r: Omit<Receipt, "at" | "host">): Receipt {
  const full: Receipt = { at: new Date().toISOString(), host: new URL(r.url).hostname, ...r };
  mkdirSync(RIALTO_HOME, { recursive: true, mode: 0o700 });
  appendFileSync(RECEIPTS_PATH, JSON.stringify(full) + "\n", { mode: 0o600 });
  return full;
}

export function readReceipts(): Receipt[] {
  if (!existsSync(RECEIPTS_PATH)) return [];
  const out: Receipt[] = [];
  for (const line of readFileSync(RECEIPTS_PATH, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as Receipt);
    } catch {
      /* a torn line never hides the rest of the ledger */
    }
  }
  return out;
}

export type ReceiptsSummary = {
  path: string;
  count: number;
  settled: number;
  totalUsdc: number;
  todayUsdc: number;
  byHost: Record<string, { count: number; usdc: number }>;
  last: Receipt[];
};

/** Totals and the last N payments. `since` is an ISO date or datetime; totals only count settled payments (status < 400). */
export function receiptsSummary(opts: { limit?: number; since?: string } = {}): ReceiptsSummary {
  const since = opts.since ? new Date(opts.since).getTime() : 0;
  const all = readReceipts().filter((r) => new Date(r.at).getTime() >= since);
  const ok = all.filter((r) => r.status < 400);
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const byHost: ReceiptsSummary["byHost"] = {};
  for (const r of ok) {
    const h = (byHost[r.host] ??= { count: 0, usdc: 0 });
    h.count += 1;
    h.usdc += r.amountUsdc;
  }
  const round = (n: number) => Math.round(n * 1e6) / 1e6;
  for (const h of Object.values(byHost)) h.usdc = round(h.usdc);
  return {
    path: RECEIPTS_PATH,
    count: all.length,
    settled: ok.length,
    totalUsdc: round(ok.reduce((a, r) => a + r.amountUsdc, 0)),
    todayUsdc: round(ok.filter((r) => new Date(r.at).getTime() >= dayStart.getTime()).reduce((a, r) => a + r.amountUsdc, 0)),
    byHost,
    last: all.slice(-(opts.limit ?? 20)).reverse(),
  };
}
