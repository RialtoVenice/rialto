/**
 * Generic x402 payer for Robinhood Chain (eip155:4663), paying in USDG.
 * Handles x402 v1 (maxAmountRequired, network "robinhood"/"eip155:4663") and v2 (amount, CAIP-2 networks)
 * with the "exact" scheme: the wallet signs an EIP-3009 TransferWithAuthorization on USDG
 * (EIP-712 domain "Global Dollar" v1, verified on chain) and the server's facilitator settles it. No gas for the payer.
 */
import { toHex, type Hex } from "viem";
import { ROBINHOOD_CHAIN_ID, USDG_ADDRESS, USDG_DECIMALS, USDG_EIP712 } from "./chains.js";
import { resolveConfig } from "./config.js";
import { getAccount } from "./wallet.js";

export type PaymentRequirement = {
  scheme: string;
  network: string;
  amount?: string;
  maxAmountRequired?: string;
  asset: string;
  payTo: string;
  resource?: string;
  description?: string;
  mimeType?: string;
  maxTimeoutSeconds?: number;
  extra?: { name?: string; version?: string };
};

export type PaymentRequired = { x402Version: number; accepts: PaymentRequirement[]; error?: string; resource?: unknown };

const ROBINHOOD_NETWORKS = new Set(["eip155:4663", "robinhood", "robinhood-chain", "hood"]);

export function isRobinhoodRequirement(r: PaymentRequirement): boolean {
  return r.scheme === "exact" && ROBINHOOD_NETWORKS.has(r.network) && r.asset.toLowerCase() === USDG_ADDRESS.toLowerCase();
}

export function parsePaymentRequired(res: Response, bodyText: string): PaymentRequired | null {
  const header = res.headers.get("payment-required") ?? res.headers.get("x-payment-required");
  if (header) {
    try {
      return JSON.parse(Buffer.from(header, "base64").toString("utf8")) as PaymentRequired;
    } catch {
      /* fall through */
    }
  }
  try {
    const json = JSON.parse(bodyText) as PaymentRequired;
    if (json && Array.isArray(json.accepts)) return json;
  } catch {
    /* not json */
  }
  return null;
}

export type PaymentReceipt = { url: string; amountUsdg: string; payTo: string; network: string; x402Version: number; status: number; settlement?: unknown };

/** Sign one USDG payment for a requirement. Returns the base64 header value and the amount. */
export async function signUsdgPayment(
  req: PaymentRequirement,
  x402Version: number,
  resourceUrl: string,
  account = getAccount(),
  resource?: unknown,
): Promise<{ header: string; amountUsdg: string }> {
  const value = BigInt(req.amount ?? req.maxAmountRequired ?? "0");
  if (value <= 0n) throw new Error("Payment requirement has no amount.");
  const now = Math.floor(Date.now() / 1000);
  const authorization = {
    from: account.address,
    to: req.payTo as `0x${string}`,
    value: value.toString(),
    validAfter: String(now - 600),
    validBefore: String(now + (req.maxTimeoutSeconds ?? 300)),
    nonce: toHex(crypto.getRandomValues(new Uint8Array(32))) as Hex,
  };
  const signature = await account.signTypedData({
    domain: {
      name: req.extra?.name ?? USDG_EIP712.name,
      version: req.extra?.version ?? USDG_EIP712.version,
      chainId: ROBINHOOD_CHAIN_ID,
      verifyingContract: req.asset as `0x${string}`,
    },
    types: {
      TransferWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    },
    primaryType: "TransferWithAuthorization",
    message: { ...authorization, value, validAfter: BigInt(authorization.validAfter), validBefore: BigInt(authorization.validBefore) },
  });
  const payload = { signature, authorization };
  const envelope =
    x402Version >= 2
      ? { x402Version, resource: resource ?? { url: resourceUrl, description: req.description ?? "", mimeType: req.mimeType ?? "" }, accepted: req, payload }
      : { x402Version: 1, scheme: "exact", network: req.network, payload };
  return { header: Buffer.from(JSON.stringify(envelope)).toString("base64"), amountUsdg: (Number(value) / 10 ** USDG_DECIMALS).toFixed(6) };
}

export type PayOptions = { method?: string; body?: string; headers?: Record<string, string>; maxUsdg?: number; dryRun?: boolean; /** Pay by burning Rialto instead of USDG (rialto.casa lane). */ burn?: boolean };

/** Hosts that understand Rialto's own headers: sign-in for the tier discount, burn receipts for paying in Rialto. */
const RIALTO_HOSTS = new Set([new URL(process.env.RIALTO_HOSTED_ORIGIN ?? "https://rialto.casa").hostname]);

/**
 * Fetch a URL and pay in USDG if it answers 402. Enforces the configured per-payment ceiling and hostname allowlist.
 * Returns the final response plus a receipt when a payment was made.
 */
export async function payFetch(url: string, opts: PayOptions = {}): Promise<{ response: Response; receipt?: PaymentReceipt; requirement?: PaymentRequirement; text: string }> {
  const cfg = resolveConfig();
  const target = new URL(url);
  if (target.protocol !== "https:") throw new Error("x402 payments are only made to HTTPS endpoints.");
  if (cfg.payAllowlist?.length && !cfg.payAllowlist.includes(target.hostname)) {
    throw new Error(`Host ${target.hostname} is not in payAllowlist (${cfg.payAllowlist.join(", ")}).`);
  }
  const extraHeaders: Record<string, string> = {};
  if (RIALTO_HOSTS.has(target.hostname)) {
    // Sign in so the 402 is priced for this wallet's tier (Holder 50% off, Pro 75% off). Free wallets lose nothing.
    try {
      const { signAccess } = await import("./access.js");
      extraHeaders["x-rialto-auth"] = (await signAccess()).token;
    } catch {
      /* no discount, no harm */
    }
  }
  const init: RequestInit = { method: opts.method ?? "GET", headers: { accept: "application/json, text/plain, */*", ...extraHeaders, ...(opts.headers ?? {}) }, body: opts.body };
  const first = await fetch(url, init);
  const firstText = await first.text();
  if (first.status !== 402) return { response: first, text: firstText };

  if (opts.burn) {
    // Pay in Rialto: burn the amount the 402 names, then retry with the burn tx as the receipt.
    let amount: number | null = null;
    try {
      amount = Number((JSON.parse(firstText) as { payInRialto?: { amount?: number } }).payInRialto?.amount ?? null) || null;
    } catch {
      /* not a Rialto lane */
    }
    if (!amount) throw new Error("This endpoint does not accept payment in Rialto (no payInRialto in the 402).");
    if (opts.dryRun) return { response: first, text: firstText };
    const { burnRialto } = await import("./feeds.js");
    const burn = await burnRialto(String(amount));
    const paidWithBurn = await fetch(url, { ...init, headers: { ...(init.headers as Record<string, string>), "x-rialto-burn": burn.hash } });
    const t = await paidWithBurn.text();
    return { response: paidWithBurn, text: t, receipt: { url, amountUsdg: "0", payTo: "0x000000000000000000000000000000000000dEaD", network: "eip155:4663", x402Version: 2, status: paidWithBurn.status, settlement: { paidInRialto: amount, burnTx: burn.hash, explorerUrl: burn.explorerUrl } } };
  }

  const required = parsePaymentRequired(first, firstText);
  if (!required) throw new Error(`402 from ${target.host} but no readable x402 payment requirements.`);
  const req = required.accepts.find(isRobinhoodRequirement);
  if (!req) {
    const offered = required.accepts.map((a) => `${a.network}/${a.asset}`).join(", ");
    throw new Error(`No USDG-on-Robinhood-Chain option offered. Endpoint accepts: ${offered || "nothing readable"}.`);
  }
  const amountUsdg = Number(req.amount ?? req.maxAmountRequired ?? "0") / 10 ** USDG_DECIMALS;
  const ceiling = opts.maxUsdg ?? cfg.maxPaymentUsdg;
  if (amountUsdg > ceiling) throw new Error(`Endpoint asks ${amountUsdg} USDG, above the ${ceiling} USDG ceiling. Raise maxPaymentUsdg to allow it.`);
  if (opts.dryRun) return { response: first, text: firstText, requirement: req };

  const { header } = await signUsdgPayment(req, required.x402Version ?? 1, url, getAccount(), required.resource);
  const paid = await fetch(url, {
    ...init,
    headers: { ...(init.headers as Record<string, string>), "PAYMENT-SIGNATURE": header, "X-PAYMENT": header },
  });
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
  return {
    response: paid,
    text,
    requirement: req,
    receipt: { url, amountUsdg: amountUsdg.toFixed(6), payTo: req.payTo, network: req.network, x402Version: required.x402Version ?? 1, status: paid.status, settlement },
  };
}
