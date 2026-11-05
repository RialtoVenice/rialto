import { createPublicClient, createWalletClient, fallback, http, type PublicClient, type Transport, type WalletClient } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { base, robinhood, RPC_BASE, RPC_ROBINHOOD, RPC_ROBINHOOD_FALLBACKS } from "./chains.js";

const robinhoodTransport = () => fallback([RPC_ROBINHOOD, ...RPC_ROBINHOOD_FALLBACKS].map((u) => http(u, { timeout: 8_000, retryCount: 1 })), { rank: false });
import { requirePrivateKey } from "./config.js";

export function getAccount(): PrivateKeyAccount {
  return privateKeyToAccount(requirePrivateKey());
}

export function robinhoodClient(): PublicClient<Transport, typeof robinhood> {
  return createPublicClient({ chain: robinhood, transport: robinhoodTransport() });
}

export function baseClient(): PublicClient<Transport, typeof base> {
  return createPublicClient({ chain: base, transport: http(RPC_BASE) });
}

export function robinhoodWallet(account: PrivateKeyAccount = getAccount()): WalletClient<Transport, typeof robinhood, PrivateKeyAccount> {
  return createWalletClient({ account, chain: robinhood, transport: robinhoodTransport() });
}

export function baseWallet(account: PrivateKeyAccount = getAccount()): WalletClient<Transport, typeof base, PrivateKeyAccount> {
  return createWalletClient({ account, chain: base, transport: http(RPC_BASE) });
}
