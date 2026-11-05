/**
 * Robinhood Chain reads and the one write Rialto ships (USDG transfer).
 * Everything here talks to the public RPC only. No third-party API keys.
 */
import { erc20Abi, formatEther, formatUnits, isAddress, parseUnits, type Address } from "viem";
import { ROBINHOOD_EXPLORER, USDG_ADDRESS, USDG_DECIMALS } from "./chains.js";
import { getAccount, robinhoodClient, robinhoodWallet } from "./wallet.js";
import { STOCK_REGISTRY } from "./stocks.js";

export type ChainStatus = {
  chainId: number;
  blockNumber: number;
  gasPriceGwei: string;
  usdgTotalSupply: string;
  explorer: string;
  rpc: string;
};

export async function chainStatus(): Promise<ChainStatus> {
  const client = robinhoodClient();
  const [chainId, blockNumber, gasPrice, supply] = await Promise.all([
    client.getChainId(),
    client.getBlockNumber(),
    client.getGasPrice(),
    client.readContract({ address: USDG_ADDRESS, abi: erc20Abi, functionName: "totalSupply" }),
  ]);
  return {
    chainId,
    blockNumber: Number(blockNumber),
    gasPriceGwei: formatUnits(gasPrice, 9),
    usdgTotalSupply: formatUnits(supply, USDG_DECIMALS),
    explorer: ROBINHOOD_EXPLORER,
    rpc: "public fallback pool",
  };
}

export type Balances = { address: Address; eth: string; usdg: string };

export async function balances(address: Address): Promise<Balances> {
  const client = robinhoodClient();
  const [eth, usdg] = await Promise.all([
    client.getBalance({ address }),
    client.readContract({ address: USDG_ADDRESS, abi: erc20Abi, functionName: "balanceOf", args: [address] }),
  ]);
  return { address, eth: formatEther(eth), usdg: formatUnits(usdg, USDG_DECIMALS) };
}

export type WalletReport = Balances & {
  txCount: number;
  isContract: boolean;
  stockTokens: { symbol: string; name: string; address: Address; balance: string }[];
  explorerUrl: string;
};

/** Read-only wallet analysis: ETH, USDG, every known Robinhood stock token, nonce, contract flag. */
export async function analyzeWallet(address: string): Promise<WalletReport> {
  if (!isAddress(address)) throw new Error(`Not an EVM address: ${address}`);
  const client = robinhoodClient();
  const [bal, txCount, code, stockBalances] = await Promise.all([
    balances(address),
    client.getTransactionCount({ address }),
    client.getCode({ address }),
    Promise.all(
      STOCK_REGISTRY.map(async (t) => {
        try {
          const raw = await client.readContract({ address: t.address, abi: erc20Abi, functionName: "balanceOf", args: [address] });
          return { ...t, balance: formatUnits(raw, t.decimals) };
        } catch {
          return { ...t, balance: "0" };
        }
      }),
    ),
  ]);
  return {
    ...bal,
    txCount,
    isContract: !!code && code !== "0x",
    stockTokens: stockBalances.filter((s) => s.balance !== "0").map(({ symbol, name, address, balance }) => ({ symbol, name, address, balance })),
    explorerUrl: `${ROBINHOOD_EXPLORER}/address/${address}`,
  };
}

/** Send USDG on Robinhood Chain from the Rialto wallet. Needs a little ETH for gas. */
export async function sendUsdg(to: string, amount: string): Promise<{ hash: `0x${string}`; explorerUrl: string }> {
  if (!isAddress(to)) throw new Error(`Not an EVM address: ${to}`);
  const account = getAccount();
  const wallet = robinhoodWallet(account);
  const hash = await wallet.writeContract({
    account,
    chain: wallet.chain,
    address: USDG_ADDRESS,
    abi: erc20Abi,
    functionName: "transfer",
    args: [to, parseUnits(amount, USDG_DECIMALS)],
  });
  await robinhoodClient().waitForTransactionReceipt({ hash });
  return { hash, explorerUrl: `${ROBINHOOD_EXPLORER}/tx/${hash}` };
}
