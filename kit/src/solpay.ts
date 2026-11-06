/**
 * x402 on Solana: pay "exact" requirements in USDC from the Solana wallet. The client builds a transaction whose fee
 * payer is the facilitator named in the requirement (extra.feePayer), adds the compute-budget instructions the scheme
 * expects, transfers USDC to the recipient's token account, signs its own part and ships it base64 in the payment
 * header. The facilitator co-signs, pays the fee and lands it: no SOL leaves this wallet for a payment.
 */
import { ComputeBudgetProgram, PublicKey, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, createTransferCheckedInstruction, getAssociatedTokenAddress, getMint } from "@solana/spl-token";
import { resolveConfig } from "./config.js";
import { USDC_MINT, getSolanaKeypair, solanaConnection } from "./solana.js";
import { parsePaymentRequired, type PaymentReceipt, type PaymentRequirement } from "./x402.js";
import { recordReceipt, settlementSignature } from "./receipts.js";

export const SOLANA_MAINNET_CAIP2 = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
const SOLANA_NETWORKS = new Set([SOLANA_MAINNET_CAIP2, "solana", "solana-mainnet"]);

type SolRequirement = PaymentRequirement & { extra?: { name?: string; version?: string; feePayer?: string } };

export function isSolanaRequirement(r: PaymentRequirement): r is SolRequirement {
  return r.scheme === "exact" && SOLANA_NETWORKS.has(r.network) && r.asset === USDC_MINT.toBase58();
}

/** Build and partially sign the payment transaction for one requirement. Returns the base64 wire transaction and the amount. */
export async function buildSolanaPayment(req: SolRequirement, kp = getSolanaKeypair()): Promise<{ transaction: string; amount: number }> {
  const feePayer = req.extra?.feePayer;
  if (!feePayer) throw new Error("The Solana requirement names no feePayer; this facilitator cannot be paid from here.");
  const conn = solanaConnection();
  const mint = new PublicKey(req.asset);
  const mintAcc = await conn.getAccountInfo(mint);
  const program = mintAcc?.owner.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
  const info = await getMint(conn, mint, "confirmed", program);
  const raw = BigInt(req.amount ?? req.maxAmountRequired ?? "0");
  if (raw <= 0n) throw new Error("The requirement carries no amount.");
  const payTo = new PublicKey(req.payTo);
  const [fromAta, toAta] = await Promise.all([getAssociatedTokenAddress(mint, kp.publicKey, false, program), getAssociatedTokenAddress(mint, payTo, true, program)]);
  const payer = new PublicKey(feePayer);
  // The exact-SVM scheme wants a versioned transaction with exactly: compute-unit limit, compute-unit price, one transfer.
  // Verifiers simulate it, so the recipient's token account must already exist (facilitators keep theirs open).
  const { blockhash } = await conn.getLatestBlockhash("confirmed");
  const message = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: blockhash,
    instructions: [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 60_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 }),
      createTransferCheckedInstruction(fromAta, mint, toAta, kp.publicKey, raw, info.decimals, [], program),
    ],
  }).compileToV0Message();
  const tx = new VersionedTransaction(message);
  tx.sign([kp]);
  return { transaction: Buffer.from(tx.serialize()).toString("base64"), amount: Number(raw) / 10 ** info.decimals };
}

/** The PAYMENT-SIGNATURE header for a Solana requirement. */
export async function signSolanaPayment(req: SolRequirement, x402Version: number, resourceUrl: string, resource?: unknown): Promise<{ header: string; amount: number }> {
  const { transaction, amount } = await buildSolanaPayment(req);
  const payload = { transaction };
  const body =
    x402Version >= 2
      ? { x402Version, resource: resource ?? { url: resourceUrl, description: req.description ?? "", mimeType: req.mimeType ?? "" }, accepted: req, payload }
      : { x402Version: 1, scheme: "exact", network: req.network, payload };
  return { header: Buffer.from(JSON.stringify(body)).toString("base64"), amount };
}

export type SolPayOptions = { method?: string; body?: string; headers?: Record<string, string>; maxUsdc?: number; dryRun?: boolean };

/** Fetch a URL and pay in USDC on Solana if it answers 402 with a Solana option. Same ceiling and allowlist as the USDG payer. */
export async function payFetchSolana(url: string, opts: SolPayOptions = {}): Promise<{ response: Response; receipt?: PaymentReceipt; requirement?: PaymentRequirement; text: string }> {
  const cfg = resolveConfig();
  const target = new URL(url);
  if (target.protocol !== "https:") throw new Error("x402 payments are only made to HTTPS endpoints.");
  if (cfg.payAllowlist?.length && !cfg.payAllowlist.includes(target.hostname)) throw new Error(`Host ${target.hostname} is not in payAllowlist (${cfg.payAllowlist.join(", ")}).`);
  const init: RequestInit = { method: opts.method ?? "GET", headers: { accept: "application/json, text/plain, */*", ...(opts.headers ?? {}) }, body: opts.body };
  const first = await fetch(url, init);
  const firstText = await first.text();
  if (first.status !== 402) return { response: first, text: firstText };
  const required = parsePaymentRequired(first, firstText);
  if (!required) throw new Error(`402 from ${target.host} but no readable x402 payment requirements.`);
  const req = required.accepts.find(isSolanaRequirement);
  if (!req) throw new Error(`No USDC-on-Solana option offered. Endpoint accepts: ${required.accepts.map((a) => `${a.network}/${a.asset}`).join(", ") || "nothing readable"}.`);
  const amount = Number(req.amount ?? req.maxAmountRequired ?? "0") / 1e6;
  if (opts.dryRun) return { response: first, text: firstText, requirement: req };
  const ceiling = opts.maxUsdc ?? cfg.maxPaymentUsdg;
  if (amount > ceiling) throw new Error(`Endpoint asks ${amount} USDC, above the ${ceiling} ceiling. Raise maxPaymentUsdg to allow it.`);
  const { header } = await signSolanaPayment(req, required.x402Version ?? 1, url, required.resource);
  const paid = await fetch(url, { ...init, headers: { ...(init.headers as Record<string, string>), "PAYMENT-SIGNATURE": header, "X-PAYMENT": header } });
  const text = await paid.text();
  const settlementHeader = paid.headers.get("payment-response") ?? paid.headers.get("x-payment-response");
  let settlement: unknown;
  if (settlementHeader) {
    try {
      settlement = JSON.parse(Buffer.from(settlementHeader, "base64").toString("utf8"));
    } catch {
      settlement = settlementHeader;
    }
  }
  recordReceipt({ kind: "x402", url, amountUsdc: amount, status: paid.status, signature: settlementSignature(settlement), payTo: req.payTo, network: req.network, cap: ceiling });
  return { response: paid, text, requirement: req, receipt: { url, amountUsdg: amount.toFixed(6), payTo: req.payTo, network: req.network, x402Version: required.x402Version ?? 1, status: paid.status, settlement } };
}

/** Top up Venice straight from Solana USDC: Venice's own x402 top-up accepts solana mainnet. No bridge, no SOL needed. */
export async function topUpSolana(amountUsd: number): Promise<{ amountCredited: number; newBalance: number; paymentId: string }> {
  const VENICE_API = "https://api.venice.ai";
  const disc = await fetch(`${VENICE_API}/api/v1/x402/top-up`, { method: "POST" });
  if (disc.status !== 402) throw new Error(`Expected 402 from Venice top-up discovery, got ${disc.status}`);
  const required = (await disc.json()) as { x402Version: number; accepts: PaymentRequirement[] };
  const base = required.accepts.find(isSolanaRequirement);
  if (!base) throw new Error("Venice did not offer a Solana USDC top-up option.");
  const minimum = Number(base.amount ?? base.maxAmountRequired ?? "5000000") / 1e6;
  if (amountUsd < minimum) throw new Error(`Minimum top-up is ${minimum} USDC.`);
  const req: SolRequirement = { ...base, amount: String(Math.round(amountUsd * 1e6)), maxAmountRequired: undefined };
  const { transaction } = await buildSolanaPayment(req);
  // Venice reads the v2 envelope for Solana: the accepted requirement travels with the payload.
  const header = Buffer.from(JSON.stringify({ x402Version: required.x402Version ?? 2, resource: { url: `${VENICE_API}/api/v1/x402/top-up`, description: "Venice top-up", mimeType: "application/json" }, accepted: req, payload: { transaction } })).toString("base64");
  const res = await fetch(`${VENICE_API}/api/v1/x402/top-up`, { method: "POST", headers: { "PAYMENT-SIGNATURE": header, "X-402-Payment": header } });
  const text = await res.text();
  if (!res.ok) throw new Error(`Venice top-up answered ${res.status}: ${text.slice(0, 300)}`);
  const data = (JSON.parse(text) as { data: { amountCredited: number; newBalance: number; paymentId: string } }).data;
  recordReceipt({ kind: "topup", url: `${VENICE_API}/api/v1/x402/top-up`, amountUsdc: amountUsd, status: res.status, signature: null, ref: data.paymentId, payTo: req.payTo, network: req.network, cap: null });
  return data;
}
