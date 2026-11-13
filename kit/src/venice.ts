/**
 * Minimal Venice AI client. Three auth modes:
 *  - Solana wallet (default when a Solana key exists): every request carries a fresh SIGN-IN-WITH-X header signed by
 *    the Solana keypair (ed25519). Venice keeps a prepaid USD ledger per wallet; `rialto sol fund` pays from that same
 *    keypair, so the wallet that pays is the wallet that signs in.
 *  - EVM wallet (`veniceWallet: "evm"`, or no Solana key): same header signed with EIP-191, ledger topped up on Base.
 *  - API key mode: Authorization: Bearer <key>, when VENICE_API_KEY is set.
 * Facts verified against api.venice.ai on 2026-09-09; Solana sign-in verified on 2026-11-13.
 */
import { createPrivateKey, randomBytes, sign as edSign } from "node:crypto";
import type { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { bytesToHex, toHex } from "viem";
import { createSiweMessage } from "viem/siwe";
import type { PrivateKeyAccount } from "viem/accounts";
import { BASE_CHAIN_ID, VENICE_API } from "./chains.js";
import { resolveConfig } from "./config.js";
import { getAccount } from "./wallet.js";
import { getSolanaKeypair } from "./solana.js";

export type VeniceAuth = { kind: "wallet"; account: PrivateKeyAccount } | { kind: "solana"; keypair: Keypair } | { kind: "apiKey"; apiKey: string };

/** CAIP-2 id of Solana mainnet, as Venice lists it in the sign-in-with-x extension of its 402. */
const SOLANA_CAIP2 = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";

/**
 * Which identity talks to Venice. An API key wins. Otherwise the Solana keypair signs in when there is one, so credit
 * bought with `rialto sol fund` is the credit that gets spent. `veniceWallet` (or RIALTO_VENICE_WALLET) forces
 * "solana" or "evm" for installs that hold credit on the other ledger.
 */
export function veniceAuth(): VeniceAuth {
  const cfg = resolveConfig();
  if (cfg.veniceApiKey) return { kind: "apiKey", apiKey: cfg.veniceApiKey };
  if (cfg.veniceWallet !== "evm") {
    try {
      return { kind: "solana", keypair: getSolanaKeypair() };
    } catch (e) {
      if (cfg.veniceWallet === "solana") throw e;
    }
  }
  return { kind: "wallet", account: getAccount() };
}

/** The address whose Venice ledger this auth reads and spends, or null in API key mode. */
export function veniceWalletAddress(auth: VeniceAuth = veniceAuth()): string | null {
  return auth.kind === "solana" ? auth.keypair.publicKey.toBase58() : auth.kind === "wallet" ? auth.account.address : null;
}

/**
 * SIGN-IN-WITH-X for a Solana wallet: the sign-in message of CAIP-122 for Solana, signed with the keypair's ed25519
 * key, base58 signature. Random nonce, 5-minute expiry, bound to the URL being called. Nothing in it works twice.
 */
export function siwxHeaderSolana(keypair: Keypair, resourceUrl: string): string {
  const now = new Date();
  const address = keypair.publicKey.toBase58();
  const fields = {
    domain: new URL(VENICE_API).host,
    address,
    statement: "Sign in to Venice AI",
    uri: resourceUrl,
    version: "1",
    chainId: SOLANA_CAIP2,
    type: "ed25519",
    nonce: randomBytes(16).toString("hex"),
    issuedAt: now.toISOString(),
    expirationTime: new Date(now.getTime() + 5 * 60_000).toISOString(),
  };
  const message = [
    `${fields.domain} wants you to sign in with your Solana account:`,
    address,
    "",
    fields.statement,
    "",
    `URI: ${fields.uri}`,
    `Version: ${fields.version}`,
    `Chain ID: ${SOLANA_CAIP2.split(":")[1]}`,
    `Nonce: ${fields.nonce}`,
    `Issued At: ${fields.issuedAt}`,
    `Expiration Time: ${fields.expirationTime}`,
  ].join("\n");
  // ed25519 over the UTF-8 message, with the 32-byte seed of the keypair wrapped as a PKCS#8 key for node:crypto.
  const key = createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.from(keypair.secretKey.slice(0, 32))]), format: "der", type: "pkcs8" });
  const signature = bs58.encode(edSign(null, Buffer.from(message, "utf8"), key));
  return Buffer.from(JSON.stringify({ ...fields, signature })).toString("base64");
}

/** Build the SIGN-IN-WITH-X header value: base64 JSON { address, message, signature, timestamp, chainId }. */
export async function siwxHeader(account: PrivateKeyAccount, resourceUrl: string): Promise<string> {
  const now = new Date();
  const message = createSiweMessage({
    domain: new URL(VENICE_API).host,
    address: account.address,
    statement: "Sign in to Venice AI",
    uri: resourceUrl,
    version: "1",
    chainId: BASE_CHAIN_ID,
    nonce: bytesToHex(crypto.getRandomValues(new Uint8Array(8))).slice(2),
    issuedAt: now,
    expirationTime: new Date(now.getTime() + 5 * 60_000),
  });
  const signature = await account.signMessage({ message });
  return Buffer.from(
    JSON.stringify({ address: account.address, message, signature, timestamp: now.getTime(), chainId: BASE_CHAIN_ID }),
  ).toString("base64");
}

export class VeniceError extends Error {
  constructor(message: string, public status: number, public body?: unknown) {
    super(message);
  }
}

export async function veniceFetch(path: string, init: RequestInit = {}, auth: VeniceAuth = veniceAuth()): Promise<Response> {
  const url = path.startsWith("http") ? path : `${VENICE_API}/api/v1${path}`;
  const headers = new Headers(init.headers);
  if (!headers.has("content-type") && init.body) headers.set("content-type", "application/json");
  if (auth.kind === "apiKey") headers.set("authorization", `Bearer ${auth.apiKey}`);
  else headers.set("SIGN-IN-WITH-X", auth.kind === "solana" ? siwxHeaderSolana(auth.keypair, url) : await siwxHeader(auth.account, url));
  return fetch(url, { ...init, headers });
}

async function asJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* keep text */
  }
  if (!res.ok) {
    const msg = typeof body === "object" && body && "error" in body ? String((body as { error: unknown }).error) : text.slice(0, 300);
    throw new VeniceError(`Venice ${res.status}: ${msg}`, res.status, body);
  }
  return body as T;
}

export type ChatMessage = { role: "system" | "user" | "assistant" | "tool"; content: string | null; tool_calls?: ToolCall[]; tool_call_id?: string; name?: string };
export type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
export type ChatTool = { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } };

export type ChatResult = {
  content: string;
  toolCalls: ToolCall[];
  model: string;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  balanceRemainingUsd: number | null;
  citations?: { url: string; title?: string }[];
  raw: unknown;
};

export async function chat(
  messages: ChatMessage[],
  opts: { model?: string; tools?: ChatTool[]; webSearch?: "off" | "auto" | "on"; temperature?: number; maxTokens?: number; auth?: VeniceAuth } = {},
): Promise<ChatResult> {
  const cfg = resolveConfig();
  const body: Record<string, unknown> = {
    model: opts.model ?? cfg.defaultModel,
    messages,
    temperature: opts.temperature ?? 0.4,
    max_completion_tokens: opts.maxTokens ?? 1200,
    venice_parameters: {
      include_venice_system_prompt: false,
      enable_web_search: opts.webSearch ?? "off",
      enable_web_citations: opts.webSearch !== undefined && opts.webSearch !== "off",
    },
  };
  if (opts.tools?.length) {
    body.tools = opts.tools;
    body.tool_choice = "auto";
  }
  const res = await veniceFetch("/chat/completions", { method: "POST", body: JSON.stringify(body) }, opts.auth);
  const balance = res.headers.get("x-balance-remaining");
  const json = await asJson<{
    model: string;
    choices: { message: { content: string | null; tool_calls?: ToolCall[] } }[];
    usage?: ChatResult["usage"];
    venice_parameters?: { web_search_citations?: { url: string; title?: string }[] };
  }>(res);
  const msg = json.choices?.[0]?.message ?? { content: "" };
  return {
    content: msg.content ?? "",
    toolCalls: msg.tool_calls ?? [],
    model: json.model,
    usage: json.usage,
    balanceRemainingUsd: balance ? Number(balance) : null,
    citations: json.venice_parameters?.web_search_citations,
    raw: json,
  };
}

export type VeniceBalance = { walletAddress: string; balanceUsd: number; canConsume: boolean; minimumTopUpUsd: number; suggestedTopUpUsd: number; diemBalanceUsd?: number };

export async function balance(auth: VeniceAuth = veniceAuth()): Promise<VeniceBalance> {
  const address = veniceWalletAddress(auth);
  if (!address) throw new Error("Venice balance is only available in wallet (x402) mode.");
  const res = await veniceFetch(`/x402/balance/${address}`, {}, auth);
  const json = await asJson<{ data: VeniceBalance }>(res);
  return json.data;
}

export type VeniceTransaction = { id: string; amount: number; balanceAfter: number; type: "TOP_UP" | "CHARGE" | "REFUND"; createdAt: string; requestId?: string; modelId?: string };

export async function transactions(limit = 20, auth: VeniceAuth = veniceAuth()): Promise<{ currentBalance: number; transactions: VeniceTransaction[] }> {
  const address = veniceWalletAddress(auth);
  if (!address) throw new Error("Venice transactions are only available in wallet (x402) mode.");
  const res = await veniceFetch(`/x402/transactions/${address}?limit=${limit}&offset=0`, {}, auth);
  const json = await asJson<{ data: { currentBalance: number; transactions: VeniceTransaction[] } }>(res);
  return json.data;
}

type TopUpRequirement = { scheme: string; network: string; amount?: string; maxAmountRequired?: string; asset: string; payTo: string; maxTimeoutSeconds?: number; extra?: { name?: string; version?: string } };

/** Ask Venice what it accepts for a top-up (the 402 discovery step). */
export async function topUpRequirements(): Promise<{ x402Version: number; accepts: TopUpRequirement[] }> {
  const res = await fetch(`${VENICE_API}/api/v1/x402/top-up`, { method: "POST" });
  if (res.status !== 402) throw new VeniceError(`Expected 402 from top-up discovery, got ${res.status}`, res.status);
  return (await res.json()) as { x402Version: number; accepts: TopUpRequirement[] };
}

/**
 * Top up the wallet's Venice balance with USDC on Base. Signs an EIP-3009 TransferWithAuthorization;
 * Venice settles it through its facilitator, so the payer needs no ETH on Base.
 */
export async function topUp(amountUsd: number, account = getAccount()): Promise<{ amountCredited: number; newBalance: number; paymentId: string }> {
  const disc = await topUpRequirements();
  const req = disc.accepts.find((a) => a.network === "eip155:8453" || a.network === "base");
  if (!req) throw new Error("Venice did not offer a Base USDC top-up option.");
  const minimum = BigInt(req.amount ?? req.maxAmountRequired ?? "5000000");
  const value = BigInt(Math.round(amountUsd * 1e6));
  if (value < minimum) throw new Error(`Minimum top-up is ${Number(minimum) / 1e6} USDC.`);
  const now = Math.floor(Date.now() / 1000);
  const authorization = {
    from: account.address,
    to: req.payTo as `0x${string}`,
    value: value.toString(),
    validAfter: String(now - 600),
    validBefore: String(now + (req.maxTimeoutSeconds ?? 300)),
    nonce: toHex(crypto.getRandomValues(new Uint8Array(32))),
  };
  const signature = await account.signTypedData({
    domain: { name: req.extra?.name ?? "USD Coin", version: req.extra?.version ?? "2", chainId: BASE_CHAIN_ID, verifyingContract: req.asset as `0x${string}` },
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
  const header = Buffer.from(
    JSON.stringify({ x402Version: disc.x402Version ?? 2, scheme: "exact", network: "base", payload: { signature, authorization } }),
  ).toString("base64");
  const res = await fetch(`${VENICE_API}/api/v1/x402/top-up`, { method: "POST", headers: { "PAYMENT-SIGNATURE": header, "X-402-Payment": header } });
  const json = await asJson<{ data: { amountCredited: number; newBalance: number; paymentId: string } }>(res);
  return json.data;
}

export type VeniceModel = { id: string; type: string; model_spec?: { traits?: string[]; pricing?: Record<string, unknown>; name?: string } };

export async function listModels(type: "text" | "image" | "all" = "text"): Promise<VeniceModel[]> {
  const res = await fetch(`${VENICE_API}/api/v1/models?type=${type}`);
  const json = await asJson<{ data: VeniceModel[] }>(res);
  return json.data;
}

export async function webSearch(query: string, limit = 5, auth: VeniceAuth = veniceAuth()): Promise<{ title: string; url: string; content: string; date?: string }[]> {
  const res = await veniceFetch("/augment/search", { method: "POST", body: JSON.stringify({ query: query.slice(0, 400), limit }) }, auth);
  const json = await asJson<{ results: { title: string; url: string; content: string; date?: string }[] }>(res);
  return json.results ?? [];
}
