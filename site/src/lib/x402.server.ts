/**
 * Rialto as an x402 seller on Robinhood Chain. Paid endpoints answer 402 with a PAYMENT-REQUIRED challenge priced in
 * USDG; a buyer sends a signed EIP-3009 authorization in PAYMENT-SIGNATURE; the Naven facilitator verifies and settles it
 * on chain; the service is delivered with a PAYMENT-RESPONSE receipt. Every USDG lands in the treasury, which buys back
 * and burns Rialto (see flywheel()). No API key, no account, no rate limit on the paid lane.
 */
import { resolveAccess } from "./access.server";
import { rialtoPriceUsd, verifyBurnPayment } from "./hood.server";
import { json } from "./json.server";

export const TREASURY = "0x987e58beD5028b28cFe5E8c709b8533D6F908ebE";
export const FACILITATOR = "https://facilitator.naven.network";
export const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
export const NETWORK = "eip155:4663";

/** Prices in atomic USDG (6 decimals). */
export const PRICES = {
  check: 20_000, // 0.02 USDG
  portfolio: 10_000, // 0.01 USDG
  pulse: 5_000, // 0.005 USDG
  batch: 50_000, // 0.05 USDG
} as const;

export const usdg = (atomic: number) => (atomic / 1e6).toFixed(6).replace(/0+$/, "").replace(/\.$/, "");

/** Holders pay less on the paid lane: sign in (x-rialto-auth or ?auth=) and the challenge is priced for your tier. */
export const DISCOUNT: Record<string, number> = { Free: 1, Holder: 0.5, Pro: 0.25 };

/** Price of a call in Rialto tokens, from the live price, with a floor so dust burns never count. */
export async function rialtoPriceFor(priceAtomic: number): Promise<number> {
  const px = await rialtoPriceUsd().catch(() => null);
  const usd = priceAtomic / 1e6;
  if (!px || px <= 0) return 100_000; // price feed down: high floor rather than a free lane
  return Math.max(100, Math.ceil(usd / px));
}

const X402_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type, payment-signature, x-payment, accept, x-rialto-auth, x-rialto-burn, authorization",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-expose-headers": "payment-required, payment-response, x-payment-response, x-rialto-price-usdg, x-rialto-price-rialto, x-rialto-burn-accepted",
};

type Requirement = { scheme: "exact"; network: string; asset: string; amount: string; payTo: string; maxTimeoutSeconds: number; extra: { name: string; version: string } };

export function requirements(resourceUrl: string, priceAtomic: number, description: string) {
  const accepts: Requirement[] = [{ scheme: "exact", network: NETWORK, asset: USDG, amount: String(priceAtomic), payTo: TREASURY, maxTimeoutSeconds: 300, extra: { name: "Global Dollar", version: "1" } }];
  return { x402Version: 2, resource: { url: resourceUrl, description, mimeType: "application/json", serviceName: "Rialto" }, accepts };
}

function b64(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString("base64");
}

function decode(raw: string): Record<string, unknown> | null {
  try {
    return JSON.parse(Buffer.from(raw.trim(), "base64").toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function facilitator(path: "/verify" | "/settle", body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(`${FACILITATOR}${path}`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(45_000) });
  const text = await res.text();
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { error: `facilitator ${res.status}: ${text.slice(0, 200)}` };
  }
}

export type Paid = { payer: string | null; transaction: string | null; amountUsdg: string; paidInRialto?: number };

/**
 * Wrap a handler behind an x402 payment. `fn` runs only after the facilitator settled the payment on chain.
 */
export async function paid(request: Request, basePriceAtomic: number, description: string, fn: (p: Paid) => Promise<unknown>): Promise<Response> {
  const url = new URL(request.url);
  const resourceUrl = `${url.origin}${url.pathname}`;
  // Tier discount: a signed-in Holder pays half, Pro a quarter. Peek only, never consume the tier's rate limit here.
  const access = await resolveAccess(request, 0).catch(() => null);
  const tierName = access?.verified ? access.tier.name : "Free";
  const priceAtomic = Math.max(1, Math.round(basePriceAtomic * (DISCOUNT[tierName] ?? 1)));
  const rialtoPrice = await rialtoPriceFor(priceAtomic);
  const req = requirements(resourceUrl, priceAtomic, description);
  const challenge = (extra: Record<string, unknown> = {}) =>
    json(
      {
        ok: false,
        error: "Payment required",
        x402: req,
        price: { usdg: usdg(priceAtomic), listUsdg: usdg(basePriceAtomic), tier: tierName, discount: `${Math.round((1 - (DISCOUNT[tierName] ?? 1)) * 100)}%` },
        payInRialto: { amount: rialtoPrice, howTo: `Burn ${rialtoPrice} Rialto (rialto burn ${rialtoPrice} --yes, or a transfer to 0x000000000000000000000000000000000000dEaD) and retry with header x-rialto-burn: <tx hash>. Or: rialto pay ${resourceUrl} --burn` },
        howTo: `rialto pay ${resourceUrl} --max ${usdg(priceAtomic)}  (x402 v2 in USDG on Robinhood Chain; sign in with x-rialto-auth for the Holder or Pro discount)`,
        ...extra,
      },
      402,
      { ...X402_HEADERS, "payment-required": b64(req), "x-x402-version": "2", "x-rialto-price-usdg": usdg(priceAtomic), "x-rialto-price-rialto": String(rialtoPrice) },
    );
  // Lane 2: pay in Rialto by burning it. The tx hash of a transfer to the dead address is the receipt.
  const burnTx = request.headers.get("x-rialto-burn");
  if (burnTx) {
    const v = await verifyBurnPayment(burnTx, rialtoPrice);
    if (!v.ok) return challenge({ burnError: v.error });
    const receipt: Paid = { payer: v.from, transaction: burnTx, amountUsdg: "0", paidInRialto: v.amount };
    try {
      const data = await fn(receipt);
      return json({ ok: true, paid: receipt, data }, 200, { ...X402_HEADERS, "x-rialto-burn-accepted": burnTx });
    } catch (e) {
      return json({ ok: false, paid: receipt, error: (e as Error).message }, 400, X402_HEADERS);
    }
  }
  const raw = request.headers.get("payment-signature") ?? request.headers.get("x-payment");
  if (!raw) return challenge();
  const envelope = decode(raw);
  if (!envelope) return json({ ok: false, error: "PAYMENT-SIGNATURE is not base64 JSON" }, 400, X402_HEADERS);
  const accepted = (envelope.accepted as Requirement | undefined) ?? req.accepts[0];
  // The buyer must have signed our own terms: same asset, recipient and at least the price.
  if (accepted.payTo?.toLowerCase() !== TREASURY.toLowerCase() || accepted.asset?.toLowerCase() !== USDG.toLowerCase() || accepted.network !== NETWORK || BigInt(accepted.amount ?? "0") < BigInt(priceAtomic)) {
    return json({ ok: false, error: "Payment terms do not match this resource", x402: req }, 402, { ...X402_HEADERS, "payment-required": b64(req) });
  }
  const body = { x402Version: 2, paymentPayload: { ...envelope, x402Version: 2 }, paymentRequirements: accepted };
  const v = await facilitator("/verify", body);
  if (v.isValid !== true) return json({ ok: false, error: `Payment rejected: ${String(v.invalidReason ?? v.error ?? "invalid")} ${String(v.invalidMessage ?? "")}`.trim(), x402: req }, 402, { ...X402_HEADERS, "payment-required": b64(req) });
  const s = await facilitator("/settle", body);
  if (s.success !== true) return json({ ok: false, error: `Settlement failed: ${String(s.errorReason ?? s.error ?? "unknown")}`, x402: req }, 402, { ...X402_HEADERS, "payment-required": b64(req) });
  const payer = (s.payer as string | undefined) ?? ((envelope.payload as { authorization?: { from?: string } } | undefined)?.authorization?.from ?? null);
  const receipt: Paid = { payer, transaction: (s.transaction as string | undefined) ?? null, amountUsdg: usdg(Number(accepted.amount)) };
  try {
    const data = await fn(receipt);
    return json({ ok: true, paid: receipt, data }, 200, { ...X402_HEADERS, "payment-response": b64(s), "x-payment-response": b64(s) });
  } catch (e) {
    return json({ ok: false, paid: receipt, error: (e as Error).message }, 400, { ...X402_HEADERS, "payment-response": b64(s) });
  }
}

export function x402Options(): Response {
  return new Response(null, { status: 204, headers: X402_HEADERS });
}
