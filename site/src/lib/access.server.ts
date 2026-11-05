/**
 * Holder tiers for the hosted API and MCP. A wallet signs a short message once a day; the server recovers the
 * address, reads its Rialto balance on Robinhood Chain and applies the tier: rate limit and unlocked tools.
 * Unsigned requests are Free tier, limited per IP. Everything here is read-only and stateless apart from a
 * per-instance rate-limit window and a 60 second balance cache.
 */
import { recoverMessageAddress } from "viem";
import { burnAccess, rialtoBalance } from "./hood.server";
import { ACCESS_TTL_MS, TIER_RANK, TIERS, accessMessage, tierFor, type Tier, type TierName } from "./tiers";

export type Access = {
  address: string | null;
  verified: boolean;
  balance: number;
  tier: Tier;
  /** Pro granted by a recent burn rather than by balance, with the unix time it ends. */
  burnUnlockUntil: number | null;
  limit: number;
  remaining: number;
  resetSeconds: number;
  /** Why the token was rejected, when one was sent. */
  authError: string | null;
};

type AuthToken = { address: string; issued: number; signature: `0x${string}` };

function decodeToken(raw: string): AuthToken | null {
  try {
    const b64 = raw.trim().replace(/-/g, "+").replace(/_/g, "/");
    const j = JSON.parse(atob(b64)) as Partial<AuthToken>;
    if (typeof j.address !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(j.address)) return null;
    if (typeof j.issued !== "number" || typeof j.signature !== "string" || !j.signature.startsWith("0x")) return null;
    return { address: j.address.toLowerCase(), issued: j.issued, signature: j.signature as `0x${string}` };
  } catch {
    return null;
  }
}

export function readToken(request: Request): string | null {
  const h = request.headers.get("x-rialto-auth");
  if (h) return h;
  const bearer = request.headers.get("authorization");
  if (bearer && /^bearer\s+/i.test(bearer)) return bearer.replace(/^bearer\s+/i, "");
  try {
    return new URL(request.url).searchParams.get("auth");
  } catch {
    return null;
  }
}

async function verifyToken(raw: string): Promise<{ address: string } | { error: string }> {
  const t = decodeToken(raw);
  if (!t) return { error: "Malformed access token. Expected base64 JSON {address, issued, signature}." };
  const age = Date.now() - t.issued;
  if (age > ACCESS_TTL_MS) return { error: "Access token expired (valid 24 hours). Sign a new one." };
  if (age < -5 * 60 * 1000) return { error: "Access token issued in the future. Check the clock." };
  try {
    const recovered = await recoverMessageAddress({ message: accessMessage(t.address, t.issued), signature: t.signature });
    if (recovered.toLowerCase() !== t.address) return { error: "Signature does not match the address." };
    return { address: t.address };
  } catch {
    return { error: "Signature could not be verified." };
  }
}

const BALANCE_CACHE = new Map<string, { at: number; value: number }>();
const BALANCE_TTL_MS = 60_000;

/** Rialto balance in whole tokens, cached for a minute. Returns 0 when the RPC is unreachable so a hiccup only downgrades, never blocks. */
export async function cachedRialtoBalance(address: string): Promise<number> {
  const key = address.toLowerCase();
  const hit = BALANCE_CACHE.get(key);
  if (hit && Date.now() - hit.at < BALANCE_TTL_MS) return hit.value;
  try {
    const value = Number((await rialtoBalance(key)).balance);
    if (BALANCE_CACHE.size > 2000) BALANCE_CACHE.clear();
    BALANCE_CACHE.set(key, { at: Date.now(), value });
    return value;
  } catch {
    return hit?.value ?? 0;
  }
}

const WINDOW_MS = 60_000;
const HITS = new Map<string, { start: number; count: number }>();

function hit(key: string, limit: number, consume = true): { remaining: number; resetSeconds: number } {
  const now = Date.now();
  let w = HITS.get(key);
  if (!w || now - w.start >= WINDOW_MS) {
    w = { start: now, count: 0 };
    if (HITS.size > 5000) HITS.clear();
    HITS.set(key, w);
  }
  if (consume) w.count += 1;
  return { remaining: limit - w.count, resetSeconds: Math.max(1, Math.ceil((w.start + WINDOW_MS - now) / 1000)) };
}

function clientIp(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? request.headers.get("cf-connecting-ip") ?? "anon";
}

/** Resolve the caller's tier and consume one request from its window. */
export async function resolveAccess(request: Request, cost = 1): Promise<Access> {
  const raw = readToken(request);
  let address: string | null = null;
  let authError: string | null = null;
  if (raw) {
    const v = await verifyToken(raw);
    if ("address" in v) address = v.address;
    else authError = v.error;
  }
  const balance = address ? await cachedRialtoBalance(address) : 0;
  let tier = address ? tierFor(balance) : TIERS[TIERS.length - 1];
  let burnUnlockUntil: number | null = null;
  if (address && tier.name !== "Pro") {
    const b = await burnAccess(address).catch(() => ({ active: false, until: null }));
    if (b.active) {
      tier = TIERS.find((t) => t.name === "Pro")!;
      burnUnlockUntil = b.until;
    }
  }
  const key = address ? `w:${address}` : `ip:${clientIp(request)}`;
  let remaining = tier.rpm;
  let resetSeconds = 60;
  if (cost <= 0) {
    const h = hit(key, tier.rpm, false);
    remaining = h.remaining;
    resetSeconds = h.resetSeconds;
  }
  for (let i = 0; i < cost; i++) {
    const h = hit(key, tier.rpm);
    remaining = h.remaining;
    resetSeconds = h.resetSeconds;
  }
  return { address, verified: !!address, balance, tier, burnUnlockUntil, limit: tier.rpm, remaining: Math.max(0, remaining), resetSeconds, authError, ...(remaining < 0 ? { remaining: -1 } : {}) };
}

export function accessHeaders(a: Access): Record<string, string> {
  return {
    "x-rialto-tier": a.tier.name,
    "x-ratelimit-limit": String(a.limit),
    "x-ratelimit-remaining": String(Math.max(0, a.remaining)),
    "x-ratelimit-reset": String(a.resetSeconds),
    "access-control-expose-headers": "x-rialto-tier, x-ratelimit-limit, x-ratelimit-remaining, x-ratelimit-reset",
  };
}

export function isLimited(a: Access): boolean {
  return a.remaining < 0;
}

export function limitMessage(a: Access): string {
  const next = TIERS.filter((t) => TIER_RANK[t.name] > TIER_RANK[a.tier.name]).sort((x, y) => x.min - y.min)[0];
  const upgrade = next ? ` Hold ${next.min.toLocaleString("en-US")} Rialto and sign in for ${next.rpm} per minute (${next.name} tier).` : "";
  return `Rate limit: ${a.limit} requests per minute on the ${a.tier.name} tier. Retry in ${a.resetSeconds}s.${upgrade}`;
}

export function hasTier(a: Access, need: TierName): boolean {
  return TIER_RANK[a.tier.name] >= TIER_RANK[need];
}

export function requireTier(a: Access, need: TierName, what: string): void {
  if (hasTier(a, need)) return;
  const t = TIERS.find((x) => x.name === need)!;
  const why = a.verified
    ? `Wallet ${a.address} holds ${a.balance.toLocaleString("en-US")} Rialto (${a.tier.name} tier).`
    : a.authError
      ? `Access token rejected: ${a.authError}`
      : "No access token was sent.";
  throw new Error(
    `${what} needs the ${need} tier: hold at least ${t.min.toLocaleString("en-US")} Rialto and sign in. ${why} ` +
      `Sign with "rialto access sign" or at https://rialto.casa/explore#access, then send the token in the x-rialto-auth header or as ?auth= on the URL.`,
  );
}

export function describeAccess(a: Access) {
  return {
    address: a.address,
    verified: a.verified,
    rialtoBalance: a.balance,
    tier: a.tier.name,
    burnUnlockUntil: a.burnUnlockUntil ? new Date(a.burnUnlockUntil * 1000).toISOString() : null,
    requestsPerMinute: a.limit,
    remainingThisMinute: Math.max(0, a.remaining),
    unlocks: a.tier.unlocks,
    tiers: TIERS.map((t) => ({ name: t.name, minRialto: t.min, requestsPerMinute: t.rpm })),
    authError: a.authError,
    burnToUnlock: "Every 10,000 Rialto sent to 0x000000000000000000000000000000000000dEaD buys 24 hours of Pro for the sender, up to 30 days per burn. rialto burn <amount>.",
    payPerCall: "No tier at all: /x402/check, /x402/portfolio, /x402/pulse, /x402/batch take USDG on Robinhood Chain through x402.",
    howToSign: a.verified ? null : 'Run "rialto access sign" with the kit, or connect a wallet at https://rialto.casa/explore#access, then send the token as x-rialto-auth or ?auth=.',
  };
}
