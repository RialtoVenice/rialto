// Builds src/data/rialto-snapshot.json: Rialto balances replayed from every Transfer log up to the current block, plus
// the volume traded since launch per pool. The server starts from this snapshot and only fetches what happened since,
// so the public RPC and GeckoTerminal budgets (both shared with every other tenant of the hosting IP) are barely
// touched at runtime. Run before a build: node scripts/snapshot.mjs
import { writeFileSync, mkdirSync } from "node:fs";
import { createPublicClient, http, parseAbiItem } from "viem";

const TOKEN = "0xe0fb5d77c627ba9c7950fc0d62d1d96603e7b7c6";
const LAUNCH_BLOCK = 58_726_000;
const RPC = "https://rpc.mainnet.chain.robinhood.com";
const GECKO = "https://api.geckoterminal.com/api/v2";

const client = createPublicClient({ transport: http(RPC, { timeout: 60_000, retryCount: 2 }) });
const transfer = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");

const head = Number(await client.getBlockNumber());
const logs = [];
let step = 100_000;
for (let from = LAUNCH_BLOCK; from <= head; ) {
  const to = Math.min(from + step - 1, head);
  try {
    logs.push(...(await client.getLogs({ address: TOKEN, event: transfer, fromBlock: BigInt(from), toBlock: BigInt(to) })));
    from = to + 1;
    if (step < 100_000) step *= 2;
  } catch (e) {
    step = Math.max(2_000, Math.floor(step / 2));
    console.error(`range shrunk to ${step}: ${String(e).slice(0, 80)}`);
  }
}
const bal = new Map();
const txs = new Set();
for (const l of logs) {
  const from = l.args.from.toLowerCase();
  const to = l.args.to.toLowerCase();
  const v = l.args.value;
  txs.add(l.transactionHash);
  if (from !== "0x0000000000000000000000000000000000000000") bal.set(from, (bal.get(from) ?? 0n) - v);
  bal.set(to, (bal.get(to) ?? 0n) + v);
}
const balances = {};
for (const [a, v] of bal) if (v > 0n) balances[a] = v.toString();

// Day-by-day history replayed from the same logs: holders, cumulative burned, transfers, wallets ever, at each UTC midnight
// and at the head. Day boundaries are found by bisecting block timestamps.
const DEAD = "0x000000000000000000000000000000000000dead";
const ZERO = "0x0000000000000000000000000000000000000000";
const tsOf = async (b) => Number((await client.getBlock({ blockNumber: BigInt(b) })).timestamp);
const headTs = await tsOf(head);
const firstTs = await tsOf(LAUNCH_BLOCK);
const boundaries = [];
for (let day = Math.floor(firstTs / 86400) * 86400 + 86400; day <= headTs; day += 86400) {
  let lo = LAUNCH_BLOCK, hi = head;
  while (hi - lo > 200) { const mid = Math.floor((lo + hi) / 2); if ((await tsOf(mid)) < day) lo = mid; else hi = mid; }
  boundaries.push({ block: hi, day: new Date(day * 1000).toISOString().slice(0, 10) });
}
boundaries.push({ block: head + 1, day: new Date(headTs * 1000).toISOString().slice(0, 10) + " (now)" });
const sorted = [...logs].sort((a, b) => Number(a.blockNumber - b.blockNumber) || a.logIndex - b.logIndex);
const run = new Map(); const seen = new Set(); let burned = 0n; let i = 0; const history = [];
for (const b of boundaries) {
  while (i < sorted.length && Number(sorted[i].blockNumber) < b.block) {
    const l = sorted[i++]; const from = l.args.from.toLowerCase(), to = l.args.to.toLowerCase(), v = l.args.value;
    seen.add(from); seen.add(to);
    if (from !== ZERO) run.set(from, (run.get(from) ?? 0n) - v);
    run.set(to, (run.get(to) ?? 0n) + v);
    if (to === DEAD) burned += v;
  }
  let holders = 0; for (const [a, v] of run) if (v > 0n && a !== DEAD && a !== ZERO) holders++;
  history.push({ day: b.day, block: Math.min(b.block - 1, head), holders, burned: Math.round(Number(burned) / 1e18), transfers: i, walletsEver: seen.size - (seen.has(ZERO) ? 1 : 0) });
}
// Per-wallet aggregates in order of first appearance (object key order is insertion order for hex keys, so the
// position of a wallet in this object is its "wallet number"): [firstBlock, lastBlock, received, sent, transfers, burned].
const wallets = {};
for (const l of sorted) {
  const from = l.args.from.toLowerCase(), to = l.args.to.toLowerCase(), b = Number(l.blockNumber), v = Number(l.args.value) / 1e18;
  if (from !== ZERO) { const w = (wallets[from] ??= [b, b, 0, 0, 0, 0]); w[1] = b; w[3] += v; w[4]++; if (to === DEAD) w[5] += v; }
  const w = (wallets[to] ??= [b, b, 0, 0, 0, 0]); w[1] = b; w[2] += v; w[4]++;
}
for (const w of Object.values(wallets)) { w[2] = Math.round(w[2] * 1e6) / 1e6; w[3] = Math.round(w[3] * 1e6) / 1e6; w[5] = Math.round(w[5] * 1e6) / 1e6; }
console.error("history:", history.map((h) => `${h.day} h=${h.holders} b=${h.burned}`).join(" | "));
console.error(`${Object.keys(wallets).length} wallets ever`);
console.error(`block ${head}: ${logs.length} transfers, ${txs.size} txs, ${Object.keys(balances).length} holders`);

// Per-pool volume since launch. GeckoTerminal allows about 30 calls a minute from one IP; pace the calls.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pools = await fetch(`${GECKO}/networks/robinhood/tokens/${TOKEN}/pools?page=1`, { headers: { accept: "application/json" } }).then((r) => r.json());
const volumes = {};
for (const p of pools.data) {
  const addr = p.attributes.address.toLowerCase();
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(`${GECKO}/networks/robinhood/pools/${addr}/ohlcv/day?limit=60&currency=usd`, { headers: { accept: "application/json" } });
    if (res.ok) {
      const d = await res.json();
      volumes[addr] = Math.round(d.data.attributes.ohlcv_list.reduce((s, c) => s + (Number(c[5]) || 0), 0));
      break;
    }
    await sleep(8_000 * (attempt + 1));
  }
  if (!(addr in volumes)) console.error(`no volume for pool ${addr}`);
  await sleep(2_500);
}
const total = Object.values(volumes).reduce((a, b) => a + b, 0);
console.error(`${Object.keys(volumes).length}/${pools.data.length} pools, $${total.toLocaleString("en-US")} since launch`);

mkdirSync("src/data", { recursive: true });
const snapshot = { block: head, generatedAt: new Date().toISOString(), transfers: logs.length, transactions: txs.size, balances, volumes, history, wallets };
writeFileSync("src/data/rialto-snapshot.json", JSON.stringify(snapshot));
console.error("wrote src/data/rialto-snapshot.json");
