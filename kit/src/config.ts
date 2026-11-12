import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

export type RialtoConfig = {
  privateKey?: `0x${string}`;
  veniceApiKey?: string;
  defaultModel?: string;
  /** Hard ceiling, in USD, for a single `rialto agent` run. */
  agentBudgetUsd?: number;
  /** Hard ceiling, in USDG, for a single x402 payment on Robinhood Chain. */
  maxPaymentUsdg?: number;
  /** Optional allowlist of hostnames the x402 payer may pay. Empty means any HTTPS host. */
  payAllowlist?: string[];
  /** Ceiling, in USDC, on the x402 payments this wallet signs per UTC day, across every run, the CLI and the MCP server. Read from the receipts ledger. */
  dailyLimitUsd?: number;
  /** Per-tool USD caps for a single `rialto agent` run, e.g. { "sol_pay": 0.05, "venice": 0.03 }. */
  toolCaps?: Record<string, number>;
  /** Solana keypair secret, base58 (64 bytes). Created by `rialto sol init`. */
  solanaSecret?: string;
  /** The Rialto mint on Solana, once the token is live there. */
  solanaMint?: string;
};

export const RIALTO_HOME = process.env.RIALTO_HOME ?? join(homedir(), ".rialto");
export const CONFIG_PATH = join(RIALTO_HOME, "config.json");

export const DEFAULTS = {
  defaultModel: "zai-org-glm-5-2",
  agentBudgetUsd: 1,
  maxPaymentUsdg: 1,
} as const;

export function readConfig(): RialtoConfig {
  if (!existsSync(CONFIG_PATH)) return {};
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as RialtoConfig;
  } catch {
    return {};
  }
}

export function writeConfig(next: RialtoConfig): void {
  mkdirSync(RIALTO_HOME, { recursive: true, mode: 0o700 });
  writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2) + "\n", { mode: 0o600 });
  try {
    chmodSync(CONFIG_PATH, 0o600);
  } catch {
    /* windows */
  }
}

/** Effective config: environment variables win over the config file. */
export function resolveConfig(): RialtoConfig & { defaultModel: string; agentBudgetUsd: number; maxPaymentUsdg: number } {
  const file = readConfig();
  const envKey = process.env.RIALTO_PRIVATE_KEY as `0x${string}` | undefined;
  return {
    ...DEFAULTS,
    ...file,
    privateKey: envKey ?? file.privateKey,
    veniceApiKey: process.env.VENICE_API_KEY ?? file.veniceApiKey,
    defaultModel: process.env.RIALTO_MODEL ?? file.defaultModel ?? DEFAULTS.defaultModel,
    agentBudgetUsd: Number(process.env.RIALTO_AGENT_BUDGET_USD ?? file.agentBudgetUsd ?? DEFAULTS.agentBudgetUsd),
    maxPaymentUsdg: Number(process.env.RIALTO_MAX_PAYMENT_USDG ?? file.maxPaymentUsdg ?? DEFAULTS.maxPaymentUsdg),
    dailyLimitUsd: process.env.RIALTO_DAILY_LIMIT_USD !== undefined ? Number(process.env.RIALTO_DAILY_LIMIT_USD) : file.dailyLimitUsd,
  };
}

/** Create a wallet if none is configured. Returns the address and whether it was freshly created. */
export function ensureWallet(): { address: `0x${string}`; created: boolean } {
  const cfg = resolveConfig();
  if (cfg.privateKey) {
    return { address: privateKeyToAccount(cfg.privateKey).address, created: false };
  }
  const privateKey = generatePrivateKey();
  const file = readConfig();
  writeConfig({ ...file, privateKey });
  return { address: privateKeyToAccount(privateKey).address, created: true };
}

export function requirePrivateKey(): `0x${string}` {
  const cfg = resolveConfig();
  if (!cfg.privateKey) {
    throw new Error("No wallet configured. Run `rialto init` first (or set RIALTO_PRIVATE_KEY).");
  }
  return cfg.privateKey;
}
