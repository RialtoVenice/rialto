/**
 * The Rialto bridge: USDG on Robinhood Chain -> USDC on Base, in the same wallet, through Relay (api.relay.link).
 * Non-custodial: the wallet approves USDG to Relay's depository and deposits; Relay fills USDC on Base in seconds.
 * Then `fundVenice` tops up Venice with that USDC. Verified with live quotes on 2026-09-09 (about 0.1 percent cost).
 */
import { erc20Abi, formatUnits, parseUnits, type Address, type Hex } from "viem";
import { BASE_CHAIN_ID, BASE_USDC_ADDRESS, RELAY_API, ROBINHOOD_CHAIN_ID, USDG_ADDRESS, USDG_DECIMALS, USDC_DECIMALS } from "./chains.js";
import { baseClient, getAccount, robinhoodClient, robinhoodWallet } from "./wallet.js";
import { topUp, topUpRequirements } from "./venice.js";

type RelayStepItem = { status?: string; data: { from: Address; to: Address; data: Hex; value?: string | number; chainId: number; gas?: string | number }; check?: { endpoint: string; method: string } };
type RelayQuote = {
  steps: { id: string; action?: string; description?: string; kind: string; items: RelayStepItem[] }[];
  details?: { currencyOut?: { amount?: string; amountFormatted?: string; amountUsd?: string }; timeEstimate?: number; totalImpact?: { percent?: string } };
};

export async function quoteUsdgToBaseUsdc(amountUsdg: string, user: Address, recipient: Address = user): Promise<RelayQuote> {
  const body = {
    user,
    recipient,
    originChainId: ROBINHOOD_CHAIN_ID,
    destinationChainId: BASE_CHAIN_ID,
    originCurrency: USDG_ADDRESS,
    destinationCurrency: BASE_USDC_ADDRESS,
    amount: parseUnits(amountUsdg, USDG_DECIMALS).toString(),
    tradeType: "EXACT_INPUT",
  };
  const res = await fetch(`${RELAY_API}/quote/v2`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Relay quote failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as RelayQuote;
}

export type BridgeResult = { provider: "relay" | "across"; hashes: Hex[]; expectedUsdc: string; timeEstimateSeconds?: number; status: string; requestId?: string };

type AcrossTx = { chainId: number; to: Address; data: Hex; value?: string | null; gas?: string | number | null };
type AcrossQuote = { approvalTxns?: AcrossTx[]; swapTx: AcrossTx; expectedOutputAmount: string; minOutputAmount: string; expectedFillTime?: number; id?: string };

/** Fallback bridge quote through Across (app.across.to), also non-custodial and keyless. */
export async function quoteAcrossUsdgToBaseUsdc(amountUsdg: string, user: Address, recipient: Address = user): Promise<AcrossQuote> {
  const params = new URLSearchParams({
    inputToken: USDG_ADDRESS,
    outputToken: BASE_USDC_ADDRESS,
    originChainId: String(ROBINHOOD_CHAIN_ID),
    destinationChainId: String(BASE_CHAIN_ID),
    amount: parseUnits(amountUsdg, USDG_DECIMALS).toString(),
    depositor: user,
    recipient,
    tradeType: "exactInput",
  });
  const res = await fetch(`https://app.across.to/api/swap/approval?${params}`);
  if (!res.ok) throw new Error(`Across quote failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as AcrossQuote;
}

/** Best keyless quote: Relay first, Across as fallback. Returns the expected USDC amount as a string. */
export async function bestQuote(amountUsdg: string, user: Address): Promise<{ provider: "relay" | "across"; expectedUsdc: string; timeEstimateSeconds?: number; relay?: RelayQuote; across?: AcrossQuote }> {
  try {
    const relay = await quoteUsdgToBaseUsdc(amountUsdg, user);
    const expectedUsdc = relay.details?.currencyOut?.amountFormatted ?? formatUnits(BigInt(relay.details?.currencyOut?.amount ?? "0"), USDC_DECIMALS);
    return { provider: "relay", expectedUsdc, timeEstimateSeconds: relay.details?.timeEstimate, relay };
  } catch (relayErr) {
    const across = await quoteAcrossUsdgToBaseUsdc(amountUsdg, user).catch((e) => {
      throw new Error(`Relay: ${(relayErr as Error).message}. Across: ${(e as Error).message}`);
    });
    return { provider: "across", expectedUsdc: formatUnits(BigInt(across.expectedOutputAmount), USDC_DECIMALS), timeEstimateSeconds: across.expectedFillTime, across };
  }
}

/** Bridge USDG from Robinhood Chain to USDC on Base for the Rialto wallet. Needs a little ETH on Robinhood Chain for gas. */
export async function bridgeUsdgToBase(amountUsdg: string, onProgress: (msg: string) => void = () => {}): Promise<BridgeResult> {
  const account = getAccount();
  const pub = robinhoodClient();
  const wallet = robinhoodWallet(account);
  const usdg = await pub.readContract({ address: USDG_ADDRESS, abi: erc20Abi, functionName: "balanceOf", args: [account.address] });
  const want = parseUnits(amountUsdg, USDG_DECIMALS);
  if (usdg < want) throw new Error(`Not enough USDG: have ${formatUnits(usdg, USDG_DECIMALS)}, need ${amountUsdg}.`);
  const eth = await pub.getBalance({ address: account.address });
  if (eth === 0n) throw new Error("The wallet has no ETH on Robinhood Chain for gas. Send a few cents of ETH first.");

  const best = await bestQuote(amountUsdg, account.address);
  onProgress(`${best.provider} quote: ${amountUsdg} USDG -> about ${best.expectedUsdc} USDC on Base in ~${best.timeEstimateSeconds ?? "?"}s.`);

  const hashes: Hex[] = [];
  let requestId: string | undefined;
  let status = "unknown";

  if (best.provider === "across" && best.across) {
    const txs = [...(best.across.approvalTxns ?? []), best.across.swapTx];
    for (const tx of txs) {
      if (tx.chainId !== ROBINHOOD_CHAIN_ID) throw new Error(`Unexpected chain ${tx.chainId} in Across step.`);
      onProgress("Sending Across transaction on Robinhood Chain...");
      const hash = await wallet.sendTransaction({ account, chain: wallet.chain, to: tx.to, data: tx.data, value: tx.value ? BigInt(tx.value) : 0n });
      hashes.push(hash);
      await pub.waitForTransactionReceipt({ hash });
    }
    status = "submitted";
    return { provider: "across", hashes, expectedUsdc: best.expectedUsdc, timeEstimateSeconds: best.timeEstimateSeconds, status };
  }

  const quote = best.relay!;
  for (const step of quote.steps) {
    if (step.kind !== "transaction") continue;
    for (const item of step.items) {
      const tx = item.data;
      if (tx.chainId !== ROBINHOOD_CHAIN_ID) throw new Error(`Unexpected chain ${tx.chainId} in Relay step ${step.id}.`);
      onProgress(`Sending ${step.id} transaction on Robinhood Chain...`);
      const hash = await wallet.sendTransaction({
        account,
        chain: wallet.chain,
        to: tx.to,
        data: tx.data,
        value: tx.value ? BigInt(tx.value) : 0n,
        gas: tx.gas ? BigInt(tx.gas) : undefined,
      });
      hashes.push(hash);
      await pub.waitForTransactionReceipt({ hash });
      if (item.check?.endpoint) {
        const m = item.check.endpoint.match(/requestId=([^&]+)/);
        if (m) requestId = m[1];
        status = await pollRelay(item.check.endpoint, onProgress);
      }
    }
  }
  return { provider: "relay", hashes, expectedUsdc: best.expectedUsdc, timeEstimateSeconds: best.timeEstimateSeconds, status, requestId };
}

async function pollRelay(endpoint: string, onProgress: (msg: string) => void): Promise<string> {
  const url = endpoint.startsWith("http") ? endpoint : `${RELAY_API}${endpoint}`;
  for (let i = 0; i < 60; i++) {
    const res = await fetch(url);
    const json = (await res.json().catch(() => ({}))) as { status?: string };
    const status = json.status ?? "pending";
    if (status === "success") {
      onProgress("Relay fill confirmed on Base.");
      return status;
    }
    if (status === "failure" || status === "refund") throw new Error(`Relay reported ${status} for ${url}`);
    await new Promise((r) => setTimeout(r, 2000));
  }
  return "timeout";
}

/** Venice refuses top-ups under this amount (read live from its 402, this is the fallback). */
const VENICE_MIN_TOPUP_USD = 5;

/**
 * One shot: bridge USDG to Base USDC, then top up Venice. This is what `rialto fund` runs.
 * The bridge costs about 1 percent, so the USDG amount is raised when needed so that the USDC landing on Base
 * (plus any USDC already there) reaches Venice's minimum. USDC already on Base is always included in the top-up.
 */
export async function fundVenice(amountUsdg: string, onProgress: (msg: string) => void = () => {}): Promise<{ bridge: BridgeResult | null; usdcOnBase: string; venice: { amountCredited: number; newBalance: number } }> {
  const account = getAccount();
  const base = baseClient();
  const readUsdc = () => base.readContract({ address: BASE_USDC_ADDRESS, abi: erc20Abi, functionName: "balanceOf", args: [account.address] });
  const existing = await readUsdc();
  const existingUsd = Number(formatUnits(existing, USDC_DECIMALS));
  let minimum = VENICE_MIN_TOPUP_USD;
  try {
    const disc = await topUpRequirements();
    const req = disc.accepts.find((a) => a.network === "eip155:8453" || a.network === "base");
    if (req?.amount) minimum = Number(req.amount) / 1e6;
  } catch {
    /* keep fallback */
  }

  let bridge: BridgeResult | null = null;
  let amount = Number(amountUsdg);
  if (existingUsd >= minimum && amount <= 0) {
    onProgress(`Using the ${existingUsd.toFixed(2)} USDC already on Base.`);
  } else {
    const quote = await bestQuote(amount.toFixed(6), account.address);
    const rate = Number(quote.expectedUsdc) / amount;
    const shortfall = minimum - existingUsd - Number(quote.expectedUsdc);
    if (shortfall > 0) {
      const bumped = Math.ceil(((minimum - existingUsd) / rate) * 1.01 * 100) / 100;
      onProgress(`${amount} USDG would land as ${quote.expectedUsdc} USDC, under Venice's ${minimum} USD minimum. Bridging ${bumped} USDG instead.`);
      amount = bumped;
    }
    bridge = await bridgeUsdgToBase(amount.toFixed(6), onProgress);
  }

  let usdc = existing;
  const target = existing + (bridge ? parseUnits((Number(bridge.expectedUsdc) * 0.98).toFixed(6), USDC_DECIMALS) : 0n);
  for (let i = 0; i < 30 && usdc < target; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    usdc = await readUsdc();
  }
  const usdcOnBase = formatUnits(usdc, USDC_DECIMALS);
  onProgress(`USDC on Base: ${usdcOnBase}. Topping up Venice...`);
  const amountUsd = Math.floor(Number(usdcOnBase) * 100) / 100;
  if (amountUsd < minimum) throw new Error(`Venice needs at least ${minimum} USDC per top-up; the wallet holds ${usdcOnBase} USDC on Base. Run \`rialto fund\` again with a larger amount.`);
  const venice = await topUp(amountUsd, account);
  onProgress(`Venice credited ${venice.amountCredited} USD. New balance: ${venice.newBalance} USD.`);
  return { bridge, usdcOnBase, venice };
}
