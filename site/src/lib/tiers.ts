/** Holder tiers of the hosted Rialto API and MCP. Client-safe: no secrets, no server imports. */
export type TierName = "Free" | "Holder" | "Pro";

export type Tier = {
  name: TierName;
  /** Minimum Rialto balance (whole tokens). */
  min: number;
  /** Requests per minute on the hosted API and MCP. */
  rpm: number;
  unlocks: string[];
};

export const TIERS: Tier[] = [
  { name: "Pro", min: 1_000_000, rpm: 600, unlocks: ["Everything in Holder", "hood_batch: up to 20 tool calls in one request", "POST /api/batch", "600 requests per minute"] },
  { name: "Holder", min: 300_000, rpm: 120, unlocks: ["Everything in Free", "hood_portfolio: the whole wallet valued in USD, Rialto included", "GET /api/portfolio/{address}", "120 requests per minute"] },
  { name: "Free", min: 0, rpm: 30, unlocks: ["Chain status, balances, wallet report, stock prices, search, pools, token stats", "30 requests per minute per IP"] },
];

export const TIER_RANK: Record<TierName, number> = { Free: 0, Holder: 1, Pro: 2 };

export function tierFor(balance: number): Tier {
  return TIERS.find((t) => balance >= t.min) ?? TIERS[TIERS.length - 1];
}

/** Access tokens are valid this long after they are signed. */
export const ACCESS_TTL_MS = 24 * 60 * 60 * 1000;

/** The exact text a wallet signs to prove it controls an address. Plain text so every wallet shows it as is. */
export function accessMessage(address: string, issued: number): string {
  return `Rialto access\nAddress: ${address.toLowerCase()}\nIssued: ${issued}\n\nSigning proves you control this wallet. It costs nothing and moves nothing.`;
}

/** Base64 JSON token carried in the x-rialto-auth header or the auth query parameter. */
export function encodeAccessToken(t: { address: string; issued: number; signature: string }): string {
  return btoa(JSON.stringify({ address: t.address.toLowerCase(), issued: t.issued, signature: t.signature }));
}
