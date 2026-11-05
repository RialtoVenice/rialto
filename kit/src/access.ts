/**
 * Holder tiers of the hosted Rialto API and MCP (https://rialto.casa). The wallet signs a short message once a
 * day; the server recovers the address, reads its Rialto balance on Robinhood Chain and applies the tier.
 * Nothing moves and no gas is spent.
 */
import { erc20Abi, formatUnits, isAddress, type Address } from "viem";
import { getAccount, robinhoodClient } from "./wallet.js";

export const RIALTO_TOKEN = "0xe0fb5d77c627ba9c7950fc0d62d1d96603e7b7c6" as const;
export const HOSTED_ORIGIN = process.env.RIALTO_HOSTED_ORIGIN ?? "https://rialto.casa";

export type TierName = "Free" | "Holder" | "Pro";
export const TIERS: { name: TierName; min: number; rpm: number; unlocks: string }[] = [
  { name: "Pro", min: 1_000_000, rpm: 600, unlocks: "Holder plus hood_batch (20 tool calls in one request), POST /api/batch" },
  { name: "Holder", min: 300_000, rpm: 120, unlocks: "Free plus hood_portfolio (whole wallet valued in USD), GET /api/portfolio/{address}" },
  { name: "Free", min: 0, rpm: 30, unlocks: "Chain status, balances, wallet report, stock prices, search, pools, token stats" },
];

export function tierFor(balance: number) {
  return TIERS.find((t) => balance >= t.min) ?? TIERS[TIERS.length - 1];
}

export function accessMessage(address: string, issued: number): string {
  return `Rialto access\nAddress: ${address.toLowerCase()}\nIssued: ${issued}\n\nSigning proves you control this wallet. It costs nothing and moves nothing.`;
}

/** Rialto balance and the tier it gives, for any address (defaults to the Rialto wallet). */
export async function accessTier(address: string = getAccount().address) {
  if (!isAddress(address)) throw new Error("Not an EVM address");
  const client = robinhoodClient();
  const [raw, decimals] = await Promise.all([
    client.readContract({ address: RIALTO_TOKEN, abi: erc20Abi, functionName: "balanceOf", args: [address as Address] }),
    client.readContract({ address: RIALTO_TOKEN, abi: erc20Abi, functionName: "decimals" }),
  ]);
  const balance = Number(formatUnits(raw, decimals));
  const tier = tierFor(balance);
  const next = TIERS.filter((t) => t.min > balance).sort((a, b) => a.min - b.min)[0] ?? null;
  return {
    address,
    rialtoBalance: balance,
    tier: tier.name,
    requestsPerMinute: tier.rpm,
    unlocks: tier.unlocks,
    nextTier: next ? { name: next.name, minRialto: next.min, missing: next.min - balance } : null,
    tiers: TIERS.map((t) => ({ name: t.name, minRialto: t.min, requestsPerMinute: t.rpm })),
  };
}

/** Sign a 24 hour access token with the Rialto wallet and return it with ready-to-use URLs. */
export async function signAccess() {
  const account = getAccount();
  const issued = Date.now();
  const signature = await account.signMessage({ message: accessMessage(account.address, issued) });
  const token = Buffer.from(JSON.stringify({ address: account.address.toLowerCase(), issued, signature })).toString("base64");
  const tier = await accessTier(account.address).catch(() => null);
  return {
    address: account.address,
    tier: tier?.tier ?? "unknown",
    rialtoBalance: tier?.rialtoBalance ?? null,
    expiresAt: new Date(issued + 24 * 60 * 60 * 1000).toISOString(),
    token,
    header: { "x-rialto-auth": token },
    mcpUrl: `${HOSTED_ORIGIN}/mcp?auth=${encodeURIComponent(token)}`,
    curl: `curl -H "x-rialto-auth: ${token}" ${HOSTED_ORIGIN}/api/access`,
  };
}
