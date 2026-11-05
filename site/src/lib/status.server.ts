/** Health of everything the site and the kit depend on: the RPC pool, GeckoTerminal, Venice, the bridges. */
import { chainVitals, GECKO, RPC_URLS } from "./hood.server";

export type Probe = { name: string; url: string; ok: boolean; ms: number; detail: string; block?: number };

async function timed<T>(fn: () => Promise<T>): Promise<{ ms: number; value?: T; error?: string }> {
  const t0 = Date.now();
  try {
    const value = await fn();
    return { ms: Date.now() - t0, value };
  } catch (e) {
    return { ms: Date.now() - t0, error: (e as Error).message };
  }
}

async function probeRpc(url: string): Promise<Probe> {
  const r = await timed(async () => {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }), signal: AbortSignal.timeout(6_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = (await res.json()) as { result?: string; error?: { message: string } };
    if (j.error) throw new Error(j.error.message);
    if (!j.result) throw new Error("no result");
    return Number(BigInt(j.result));
  });
  return { name: new URL(url).host, url, ok: r.error === undefined, ms: r.ms, detail: r.error ?? `block ${r.value!.toLocaleString("en-US")}`, block: r.value };
}

async function probeHttp(name: string, url: string, init: RequestInit = {}, okWhen: (status: number) => boolean = (s) => s < 500): Promise<Probe> {
  const r = await timed(async () => {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(8_000) });
    if (!okWhen(res.status)) throw new Error(`HTTP ${res.status}`);
    return res.status;
  });
  return { name, url, ok: r.error === undefined, ms: r.ms, detail: r.error ?? `HTTP ${r.value}` };
}

export async function status() {
  const [rpcs, gecko, veniceModels, veniceX402, relay, across, blockscout, vitals] = await Promise.all([
    Promise.all(RPC_URLS.map(probeRpc)),
    probeHttp("GeckoTerminal", `${GECKO}/networks/robinhood/tokens/0x5fc5360d0400a0fd4f2af552add042d716f1d168`, { headers: { accept: "application/json" } }, (s) => s === 200 || s === 429),
    probeHttp("Venice API", "https://api.venice.ai/api/v1/models", {}, (s) => s === 200 || s === 401),
    probeHttp("Venice x402 ledger", "https://api.venice.ai/api/v1/x402/balance/0x000000000000000000000000000000000000dEaD", {}, (s) => s === 200 || s === 401 || s === 402),
    probeHttp("Relay bridge", "https://api.relay.link/chains", { headers: { accept: "application/json" } }),
    probeHttp("Across bridge", "https://app.across.to/api/available-routes?originChainId=4663", { headers: { accept: "application/json" } }),
    probeHttp("Blockscout explorer", "https://robinhoodchain.blockscout.com/", {}, (s) => s < 500),
    chainVitals().catch(() => null),
  ]);
  const heights = rpcs.filter((p) => p.ok && p.block !== undefined).map((p) => p.block!);
  const head = heights.length ? Math.max(...heights) : null;
  const rpcRows = rpcs.map((p) => ({ ...p, lag: p.block !== undefined && head !== null ? head - p.block : null }));
  const services = [gecko, veniceModels, veniceX402, relay, across, blockscout];
  const okCount = rpcRows.filter((p) => p.ok).length + services.filter((p) => p.ok).length;
  const total = rpcRows.length + services.length;
  return {
    overall: rpcRows.some((p) => p.ok) && veniceModels.ok ? (okCount === total ? "all systems go" : "degraded") : "down",
    okCount,
    total,
    head,
    vitals,
    rpcs: rpcRows,
    services,
    checkedAt: new Date().toISOString(),
  };
}
