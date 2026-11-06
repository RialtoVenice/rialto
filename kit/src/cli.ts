#!/usr/bin/env node
import { Command } from "commander";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { accessTier, signAccess } from "./access.js";
import { burnRialto, chainVitals, flywheel, recentTrades, rialtoBurns, rialtoHistory, rialtoHolders, rialtoBadge, rialtoLeaderboard, rialtoRank, rialtoToken, tokenCheck, usdgTransfers, watch } from "./feeds.js";
import { isAddress, type Address } from "viem";
import { runAgent, parseToolCaps } from "./agent.js";
import { fundVenice, bestQuote, bridgeUsdgToBase } from "./bridge.js";
import { BASE_USDC_ADDRESS, ROBINHOOD_EXPLORER, USDG_ADDRESS } from "./chains.js";
import { CONFIG_PATH, ensureWallet, readConfig, resolveConfig, writeConfig } from "./config.js";
import { analyzeWallet, balances, chainStatus, sendUsdg } from "./hood.js";
import { serveStdio } from "./mcp.js";
import { findStock, stockPrice, topPools, STOCK_REGISTRY } from "./stocks.js";
import { balance as veniceBalance, chat, listModels, topUp, transactions, webSearch } from "./venice.js";
import { getAccount } from "./wallet.js";
import { payFetch } from "./x402.js";
import { burnSpl, ensureSolanaWallet, getSolanaKeypair, sendSol, sendSpl, solBurns, solHolders, solStatus, solStock, solToken, solTrades, SOLANA_RPC } from "./solana.js";
import { payFetchSolana, topUpSolana } from "./solpay.js";
import { receiptsSummary } from "./receipts.js";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8")) as { version: string };

const program = new Command();
program.name("rialto").description("Venice AI agent kit for Robinhood Chain. Pay in USDG, think with Venice.").version(pkg.version);

const out = (v: unknown) => console.log(typeof v === "string" ? v : JSON.stringify(v, null, 2));
const fail = (e: unknown) => {
  console.error(`error: ${(e as Error).message ?? e}`);
  process.exit(1);
};

program
  .command("init")
  .description("Create the Rialto wallet (or show the existing one) and print funding instructions")
  .option("--venice-key <key>", "store a Venice API key instead of paying from the wallet")
  .action(async (o: { veniceKey?: string }) => {
    try {
      const { address, created } = ensureWallet();
      if (o.veniceKey) writeConfig({ ...readConfig(), veniceApiKey: o.veniceKey });
      const cfg = resolveConfig();
      out(`${created ? "Created" : "Using"} wallet ${address}`);
      out(`Config: ${CONFIG_PATH} (private key stored with mode 600; back it up)`);
      out("");
      out("Fund it on Robinhood Chain (chain id 4663):");
      out(`  1. Send USDG (${USDG_ADDRESS}) to ${address}`);
      out(`  2. Send a few cents of ETH to the same address for gas (bridging and USDG transfers need it)`);
      out(`  Explorer: ${ROBINHOOD_EXPLORER}/address/${address}`);
      out("");
      out(cfg.veniceApiKey ? "Venice: API key mode." : "Venice: wallet mode. Run `rialto fund 10` to turn 10 USDG into 10 USD of Venice credit.");
    } catch (e) {
      fail(e);
    }
  });

program
  .command("status")
  .description("Wallet balances on Robinhood Chain, Venice credit, chain status")
  .action(async () => {
    try {
      const account = getAccount();
      const [hood, chain] = await Promise.all([balances(account.address), chainStatus()]);
      let venice: unknown;
      const cfg = resolveConfig();
      if (cfg.veniceApiKey) venice = "API key mode";
      else {
        try {
          venice = await veniceBalance();
        } catch (e) {
          venice = { error: (e as Error).message };
        }
      }
      out({ address: account.address, robinhoodChain: hood, venice, chain });
    } catch (e) {
      fail(e);
    }
  });

const access = program.command("access").description("Holder tiers of the hosted API and MCP at rialto.casa (Rialto token balance)");
access
  .command("tier [address]", { isDefault: true })
  .description("Tier and Rialto balance of an address (default: this wallet)")
  .action(async (address?: string) => {
    try {
      out(await accessTier(address));
    } catch (e) {
      fail(e);
    }
  });
access
  .command("sign")
  .description("Sign a 24 hour access token with this wallet; paste the mcpUrl into any MCP client or send the header")
  .action(async () => {
    try {
      out(await signAccess());
    } catch (e) {
      fail(e);
    }
  });

program
  .command("burn <amount>")
  .description("Send Rialto from this wallet to the dead address. Irreversible. Every 10,000 buys 24 h of Pro on rialto.casa")
  .option("--yes", "skip the confirmation")
  .action(async (amount: string, o: { yes?: boolean }) => {
    try {
      if (!o.yes) {
        console.error(`This sends ${amount} Rialto to 0x000000000000000000000000000000000000dEaD forever. Re-run with --yes to confirm.`);
        process.exit(2);
      }
      out(await burnRialto(amount));
    } catch (e) {
      fail(e);
    }
  });

program
  .command("flywheel")
  .description("x402 revenue received by the treasury, Rialto bought back and burned, balances")
  .action(async () => {
    try {
      out(await flywheel());
    } catch (e) {
      fail(e);
    }
  });

program
  .command("check <token>")
  .description("Check any token contract on Robinhood Chain: identity, supply, age, holders, concentration, liquidity, flags")
  .action(async (token: string) => {
    try {
      out(await tokenCheck(token));
    } catch (e) {
      fail(e);
    }
  });

program
  .command("transfers")
  .description("USDG transfers in the last N blocks on Robinhood Chain: count, volume, largest, latest")
  .option("-n, --blocks <n>", "blocks to scan (10 to 400)", "120")
  .option("-l, --limit <n>", "rows per list", "20")
  .action(async (o: { blocks: string; limit: string }) => {
    try {
      out(await usdgTransfers(Number(o.blocks), Number(o.limit)));
    } catch (e) {
      fail(e);
    }
  });

program
  .command("trades [token]")
  .description("Recent trades for RIALTO (default), AAPL, TSLA, NVDA or any official stock ticker")
  .option("-l, --limit <n>", "rows", "20")
  .action(async (token: string | undefined, o: { limit: string }) => {
    try {
      out(await recentTrades(token ?? "RIALTO", Number(o.limit)));
    } catch (e) {
      fail(e);
    }
  });

program
  .command("token")
  .description("Rialto token: price, FDV, liquidity, 24h volume, volume since launch across every pool")
  .action(async () => {
    try {
      out(await rialtoToken());
    } catch (e) {
      fail(e);
    }
  });

program
  .command("burns")
  .description("Every burn of the Rialto token, from the chain, with the running total")
  .action(async () => {
    try {
      out(await rialtoBurns());
    } catch (e) {
      fail(e);
    }
  });

program
  .command("holders")
  .description("Rialto holder count, top holders and concentration, with the block the figures are current to")
  .option("-n, --top <n>", "top holders to list", "10")
  .action(async (o: { top: string }) => {
    try {
      out(await rialtoHolders(Number(o.top)));
    } catch (e) {
      fail(e);
    }
  });

program
  .command("history")
  .description("Rialto growth day by day since launch (holders, burned, transfers, wallets ever) and who holds how much by tier")
  .action(async () => {
    try {
      out(await rialtoHistory());
    } catch (e) {
      fail(e);
    }
  });

program
  .command("vitals")
  .description("Measured chain vitals: blocks per second, average block time, fee of one token transfer in ETH and USD")
  .action(async () => {
    try {
      out(await chainVitals());
    } catch (e) {
      fail(e);
    }
  });

program
  .command("rank [address]")
  .description("Where a wallet stands on the Rialto ledger: rank among holders, wallet number since launch, days held, never sold, day one, share text (default: this wallet)")
  .option("--json", "raw JSON instead of text")
  .action(async (address: string | undefined, o: { json?: boolean }) => {
    try {
      let a = address;
      if (!a) a = getAccount().address;
      if (!isAddress(a)) throw new Error("not an EVM address");
      const r = await rialtoRank(a);
      if (o.json) return out(r);
      const n = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 0 });
      const lines = [
        `${r.address}${r.label ? `  (${r.label})` : ""}`,
        r.rank ? `rank        #${n(r.rank)} of ${n(r.holders)} holders (top ${r.topPct}%)` : "rank        not a holder right now",
        r.walletNo ? `wallet no.  #${n(r.walletNo)} of ${n(r.walletsEver)} wallets ever` : "wallet no.  never held Rialto",
        `balance     ${n(r.balance)} Rialto (${r.sharePct}% of supply), ${r.tier} tier${r.nextTier ? `, ${n(r.nextTier.need)} more for ${r.nextTier.name}` : ""}`,
        r.firstDay ? `since       ${r.firstDay}${r.daysHeld !== null ? ` (${r.daysHeld} days)` : ""}, ${r.transfers} transfers, received ${n(r.received)}, sent ${n(r.sent)}${r.burned ? `, burned ${n(r.burned)}` : ""}` : "",
        [r.diamond ? "never sold" : "", r.dayOne ? "day one" : ""].filter(Boolean).join(" · "),
        `badge       ${r.badgeUrl}`,
        `share       ${r.shareText}`,
        `block       ${n(r.asOfBlock)}`,
      ].filter(Boolean);
      console.log(lines.join("\n"));
    } catch (e) {
      fail(e);
    }
  });

program
  .command("badge [address]")
  .description("Badge of a wallet from rialto.casa: URL, Markdown snippet for a README, and the SVG itself (default: this wallet)")
  .option("-o, --out <file>", "write the SVG to this file")
  .option("--json", "raw JSON instead of text")
  .action(async (address: string | undefined, o: { out?: string; json?: boolean }) => {
    try {
      const a = address ?? getAccount().address;
      if (!isAddress(a)) throw new Error("not an EVM address");
      const b = await rialtoBadge(a);
      if (o.out) writeFileSync(o.out, b.svg);
      if (o.json) return out({ url: b.url, markdown: b.markdown, file: o.out ?? null });
      console.log(`url       ${b.url}`);
      console.log(`markdown  ${b.markdown}`);
      if (o.out) console.log(`written   ${o.out}`);
    } catch (e) {
      fail(e);
    }
  });

program
  .command("share [address]")
  .description("The share text of a wallet (rank, wallet number, never sold, day one) and the X post link that carries it; --open opens it (default: this wallet)")
  .option("--open", "open the X compose window in the default browser")
  .action(async (address: string | undefined, o: { open?: boolean }) => {
    try {
      const a = address ?? getAccount().address;
      if (!isAddress(a)) throw new Error("not an EVM address");
      const r = await rialtoRank(a);
      console.log(r.shareText);
      console.log(r.shareUrl);
      if (o.open) {
        const { spawn } = await import("node:child_process");
        const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
        const args = process.platform === "win32" ? ["/c", "start", "", r.shareUrl] : [r.shareUrl];
        spawn(cmd, args, { detached: true, stdio: "ignore" }).unref();
      }
    } catch (e) {
      fail(e);
    }
  });

const csvOf = (rows: Record<string, unknown>[]): string => {
  if (!rows.length) return "";
  const cols = Object.keys(rows[0]);
  const cell = (v: unknown) => { const t = v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\n") + "\n";
};

program
  .command("export <what>")
  .description("The ledger as a file: holders (top N), leaderboard (rank, first day, flags), burns, history (day by day). JSON by default, --csv for a spreadsheet")
  .option("--csv", "comma-separated values instead of JSON")
  .option("-n, --top <n>", "rows for holders and leaderboard (max 50 and 100)", "50")
  .option("-o, --out <file>", "write to this file instead of stdout")
  .action(async (what: string, o: { csv?: boolean; top: string; out?: string }) => {
    try {
      const n = Number(o.top);
      let rows: Record<string, unknown>[];
      let meta: Record<string, unknown> = {};
      if (what === "holders") {
        const h = await rialtoHolders(Math.min(n, 50));
        rows = h.top.map((r) => ({ address: r.address, balance: r.balance, sharePct: r.sharePct, label: r.label ?? "", isContract: r.isContract }));
        meta = { holders: h.holders, transfers: h.transfers, asOfBlock: h.asOfBlock, top10SharePct: h.top10SharePct };
      } else if (what === "leaderboard") {
        const b = await rialtoLeaderboard(Math.min(n, 100));
        rows = b.rows.map((r) => ({ rank: r.rank, address: r.address, balance: r.balance, sharePct: r.sharePct, firstDay: r.firstDay ?? "", walletNo: r.walletNo, neverSold: r.diamond, dayOne: r.dayOne, label: r.label ?? "" }));
        meta = { holders: b.holders, walletsEver: b.walletsEver, diamondHands: b.diamondHands, dayOneStillHolding: b.dayOneStillHolding, exited: b.exited, medianBalance: b.medianBalance, asOfBlock: b.asOfBlock };
      } else if (what === "burns") {
        const b = await rialtoBurns();
        rows = b.burns.map((x) => ({ block: x.block, time: x.timestamp ? new Date(x.timestamp * 1000).toISOString() : "", amount: Math.round(x.amountNum * 100) / 100, from: x.from, tx: x.tx }));
        meta = { count: b.count, burnedTotal: b.burnedTotal, burnedPct: b.burnedPct };
      } else if (what === "history") {
        const h = await rialtoHistory();
        rows = h.history.map((p) => ({ day: p.day, block: p.block, holders: p.holders, burned: p.burned, transfers: p.transfers, walletsEver: p.walletsEver }));
        meta = { asOfBlock: h.asOfBlock, holders: h.holders, walletsEver: h.walletsEver };
      } else throw new Error("export what? holders, leaderboard, burns or history");
      const text = o.csv ? csvOf(rows) : JSON.stringify({ what, exportedAt: new Date().toISOString(), ...meta, rows }, null, 2) + "\n";
      if (o.out) {
        writeFileSync(o.out, text);
        console.error(`wrote ${rows.length} rows to ${o.out}`);
      } else process.stdout.write(text);
    } catch (e) {
      fail(e);
    }
  });

program
  .command("compare <a> <b>")
  .description("Two wallets side by side on the Rialto ledger: rank, balance, tier, wallet number, days held, never sold, day one")
  .option("--json", "raw JSON instead of text")
  .action(async (a: string, b: string, o: { json?: boolean }) => {
    try {
      if (!isAddress(a) || !isAddress(b)) throw new Error("both arguments must be EVM addresses");
      const [x, y] = await Promise.all([rialtoRank(a), rialtoRank(b)]);
      if (o.json) return out({ a: x, b: y });
      const n = (v: number | null) => (v === null ? "—" : v.toLocaleString("en-US", { maximumFractionDigits: 0 }));
      const short = (s: string) => `${s.slice(0, 8)}…${s.slice(-4)}`;
      const rows: [string, string, string][] = [
        ["", short(x.address), short(y.address)],
        ["rank", x.rank ? `#${n(x.rank)}` : "not a holder", y.rank ? `#${n(y.rank)}` : "not a holder"],
        ["balance", n(x.balance), n(y.balance)],
        ["share %", String(x.sharePct), String(y.sharePct)],
        ["tier", x.tier, y.tier],
        ["wallet no.", x.walletNo ? `#${n(x.walletNo)}` : "—", y.walletNo ? `#${n(y.walletNo)}` : "—"],
        ["since", x.firstDay ?? "—", y.firstDay ?? "—"],
        ["days held", n(x.daysHeld), n(y.daysHeld)],
        ["received", n(x.received), n(y.received)],
        ["sent", n(x.sent), n(y.sent)],
        ["burned", n(x.burned), n(y.burned)],
        ["never sold", x.diamond ? "yes" : "no", y.diamond ? "yes" : "no"],
        ["day one", x.dayOne ? "yes" : "no", y.dayOne ? "yes" : "no"],
      ];
      for (const [k, l, r] of rows) console.log(`${k.padEnd(11)} ${l.padStart(16)}  ${r.padStart(16)}`);
      console.log(`${n(x.holders)} holders, ${n(x.walletsEver)} wallets ever, block ${n(x.asOfBlock)}`);
    } catch (e) {
      fail(e);
    }
  });

program
  .command("leaderboard")
  .description("Top Rialto holders with rank, first day and diamond-hands flag, plus cohort figures")
  .option("-n, --top <n>", "rows, max 100", "25")
  .option("--json", "raw JSON instead of text")
  .action(async (o: { top: string; json?: boolean }) => {
    try {
      const b = await rialtoLeaderboard(Number(o.top));
      if (o.json) return out(b);
      const n = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 0 });
      console.log(`${n(b.holders)} holders, ${n(b.walletsEver)} wallets ever, ${n(b.diamondHands)} never sold, ${n(b.dayOneStillHolding)}/${n(b.dayOneWallets)} day-one wallets still holding, ${n(b.exited)} exited, median ${n(b.medianBalance)} Rialto. Block ${n(b.asOfBlock)}.`);
      for (const r of b.rows) console.log(`${String(r.rank).padStart(3)}  ${r.address}  ${n(r.balance).padStart(13)}  ${String(r.sharePct).padStart(5)}%  ${r.firstDay ?? "          "}  #${n(r.walletNo).padEnd(6)}${r.diamond ? " never sold" : ""}${r.dayOne ? " day one" : ""}${r.label ? `  ${r.label}` : ""}`);
    } catch (e) {
      fail(e);
    }
  });

program
  .command("watch")
  .description("Follow Robinhood Chain live: blocks, USDG flow, Rialto trades, burns, a wallet's balances and rank. Filter with --only, forward to a webhook")
  .option("-w, --wallet <address>", "also watch this wallet's ETH, USDG and Rialto balances (default: the Rialto wallet if one exists)")
  .option("-e, --every <seconds>", "poll interval, minimum 5", "15")
  .option("--json", "one JSON object per line instead of text")
  .option("--once", "one pass, then exit")
  .option("--only <types>", "comma-separated event types to keep: block,usdg,trade,burn,wallet,rank,error")
  .option("--webhook <url>", "POST every kept event as JSON to this URL (one request per event)")
  .option("--discord", "with --webhook: same as --format discord")
  .option("--format <kind>", "with --webhook: raw (the event as JSON, default), discord ({content}), slack ({text})")
  .option("--min-usd <n>", "drop trades smaller than this many USD (other event types are untouched)")
  .action(async (o: { wallet?: string; every: string; json?: boolean; once?: boolean; only?: string; webhook?: string; discord?: boolean; format?: string; minUsd?: string }) => {
    try {
      const format = o.format ?? (o.discord ? "discord" : "raw");
      if (!["raw", "discord", "slack"].includes(format)) throw new Error("--format must be raw, discord or slack");
      const minUsd = o.minUsd === undefined ? 0 : Number(o.minUsd);
      if (!Number.isFinite(minUsd) || minUsd < 0) throw new Error("--min-usd must be a positive number");
      const keep = o.only ? new Set(o.only.split(",").map((t) => t.trim()).filter(Boolean)) : null;
      if (keep) for (const t of keep) if (!["block", "usdg", "trade", "burn", "wallet", "rank", "error"].includes(t)) throw new Error(`--only: unknown event type ${t}`);
      if (o.webhook && !/^https?:\/\//.test(o.webhook)) throw new Error("--webhook must be an http(s) URL");
      const post = async (body: unknown) => {
        try {
          const res = await fetch(o.webhook!, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
          if (!res.ok) console.error(`webhook: HTTP ${res.status}`);
        } catch (e) {
          console.error(`webhook: ${(e as Error).message}`);
        }
      };
      let wallet: Address | undefined;
      if (o.wallet) {
        if (!isAddress(o.wallet)) throw new Error("--wallet is not an EVM address");
        wallet = o.wallet;
      } else {
        try {
          wallet = getAccount().address;
        } catch {
          wallet = undefined;
        }
      }
      const usd = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: n < 1 ? 6 : 2 })}`;
      const stamp = () => new Date().toISOString().slice(11, 19);
      if (!o.json) console.error(`watching Robinhood Chain every ${Math.max(5, Number(o.every))} s${wallet ? `, wallet ${wallet}` : ""}${keep ? `, only ${[...keep].join(",")}` : ""}${minUsd > 0 ? `, trades from ${minUsd}` : ""}${o.webhook ? `, webhook on (${format})` : ""}. Ctrl-C to stop.`);
      for await (const ev of watch({ wallet, everyMs: Number(o.every) * 1000, once: !!o.once })) {
        if (keep && !keep.has(ev.type)) continue;
        if (minUsd > 0 && ev.type === "trade" && ev.usd < minUsd) continue;
        const line =
          ev.type === "block" ? `block ${ev.number.toLocaleString("en-US")} · ${ev.txCount} tx`
          : ev.type === "usdg" ? `USDG last ${ev.blocks} blocks: ${ev.transfers} transfers, ${usd(ev.volumeUsdg)}`
          : ev.type === "trade" ? `${ev.kind === "buy" ? "BUY " : "SELL"} ${usd(ev.usd)} Rialto @ ${usd(ev.priceUsd)}  ${ev.explorerUrl}`
          : ev.type === "burn" ? `BURN ${ev.amount.toLocaleString("en-US")} Rialto from ${ev.from.slice(0, 10)}…  total ${ev.burnedTotal.toLocaleString("en-US")} (${ev.burnedPct}%)  ${ev.explorerUrl}`
          : ev.type === "wallet" ? `wallet ${ev.field.toUpperCase()} ${ev.before} → ${ev.after}`
          : ev.type === "rank" ? `RANK ${ev.before ? `#${ev.before} → ` : ""}${ev.rank ? `#${ev.rank} of ${ev.holders} holders` : `not a holder (${ev.holders} holders)`}${ev.walletNo ? `, wallet #${ev.walletNo}` : ""}${ev.diamond ? ", never sold" : ""}`
          : `error: ${ev.message}`;
        if (o.json) console.log(JSON.stringify({ at: new Date().toISOString(), ...ev }));
        else console.log(`${stamp()}  ${line}`);
        if (o.webhook) await post(format === "discord" ? { content: `Rialto · ${line}` } : format === "slack" ? { text: `Rialto · ${line}` } : { at: new Date().toISOString(), ...ev });
      }
    } catch (e) {
      fail(e);
    }
  });

// ---------------------------------------------------------------------------------------------
// Solana: the Rialto relaunch chain. Same shapes as the Robinhood Chain commands, one keypair in the same config file.
// ---------------------------------------------------------------------------------------------
const sol = program.command("sol").description("Rialto on Solana: wallet, balances, the Rialto mint (supply, holders, burns), trade tape, USDC and SOL transfers");
sol
  .command("init")
  .description("Create the Solana keypair (or show the existing one). The secret stays in ~/.rialto/config.json")
  .action(() => {
    try {
      const { address, created } = ensureSolanaWallet();
      out(`${created ? "Created" : "Using"} Solana wallet ${address}`);
      out(`Fund it with a little SOL for fees and USDC to pay. RPC: ${SOLANA_RPC} (set SOLANA_RPC_URL for a private endpoint).`);
    } catch (e) {
      fail(e);
    }
  });
sol
  .command("status [address]")
  .description("SOL, USDC and Rialto balances of an address (default: this Solana wallet), current slot")
  .action(async (address: string | undefined) => {
    try {
      out(await solStatus(address));
    } catch (e) {
      fail(e);
    }
  });
sol
  .command("config <key> [value]")
  .description("Solana settings: mint (the Rialto mint address). Without a value, prints the current one")
  .action((key: string, value?: string) => {
    try {
      if (key !== "mint") throw new Error("known keys: mint");
      const cfg = readConfig();
      if (value === undefined) return out({ mint: process.env.RIALTO_SOLANA_MINT ?? cfg.solanaMint ?? null });
      writeConfig({ ...cfg, solanaMint: value });
      out(`Rialto mint on Solana set to ${value}`);
    } catch (e) {
      fail(e);
    }
  });
sol
  .command("token [mint]")
  .description("Mint facts: supply, decimals, authorities, the 20 largest accounts with owners, price and pool from GeckoTerminal")
  .action(async (mint?: string) => {
    try {
      out(await solToken(mint));
    } catch (e) {
      fail(e);
    }
  });
sol
  .command("holders [mint]")
  .description("Every wallet holding the mint (full scan when the RPC allows it, else the 20 largest), top holders, concentration")
  .option("-n, --top <n>", "top holders to list", "20")
  .action(async (mint: string | undefined, o: { top: string }) => {
    try {
      out(await solHolders(mint, Number(o.top)));
    } catch (e) {
      fail(e);
    }
  });
sol
  .command("burns [mint]")
  .description("Burn instructions found in the mint's recent transactions, with amounts, authorities and signatures")
  .option("-s, --scan <n>", "transactions to scan, newest first", "100")
  .action(async (mint: string | undefined, o: { scan: string }) => {
    try {
      out(await solBurns(mint, Number(o.scan)));
    } catch (e) {
      fail(e);
    }
  });
sol
  .command("trades [mint]")
  .description("Recent trades of the mint on its deepest pool: buys and sells, USD size, price, last hour totals")
  .option("-l, --limit <n>", "rows", "20")
  .action(async (mint: string | undefined, o: { limit: string }) => {
    try {
      out(await solTrades(mint, Number(o.limit)));
    } catch (e) {
      fail(e);
    }
  });
sol
  .command("send <to> <amount>")
  .description("Send USDC (default), SOL (--sol) or the Rialto mint (--rialto) from this Solana wallet. Irreversible")
  .option("--sol", "send SOL instead of USDC")
  .option("--rialto", "send the configured Rialto mint instead of USDC")
  .option("--yes", "skip the confirmation line")
  .action(async (to: string, amount: string, o: { sol?: boolean; rialto?: boolean; yes?: boolean }) => {
    try {
      const n = Number(amount);
      if (!Number.isFinite(n) || n <= 0) throw new Error("amount must be a positive number");
      if (!o.yes) throw new Error(`This sends ${n} ${o.sol ? "SOL" : o.rialto ? "Rialto" : "USDC"} to ${to} on Solana and cannot be undone. Add --yes to confirm.`);
      const mint = o.rialto ? (process.env.RIALTO_SOLANA_MINT ?? readConfig().solanaMint) : undefined;
      if (o.rialto && !mint) throw new Error("No Rialto mint configured: rialto sol config mint <address>");
      out(o.sol ? await sendSol(to, n) : await sendSpl(to, n, mint));
    } catch (e) {
      fail(e);
    }
  });
sol
  .command("fund <amountUsd>")
  .description("Top up Venice straight from this wallet's USDC on Solana (Venice accepts Solana x402 top-ups; minimum 5). No bridge, no SOL fee")
  .action(async (amountUsd: string) => {
    try {
      const n = Number(amountUsd);
      if (!Number.isFinite(n) || n <= 0) throw new Error("amount must be a positive number of USD");
      const r = await topUpSolana(n);
      out(`Venice credited ${r.amountCredited} USD from Solana USDC. New balance: ${r.newBalance} USD. Payment ${r.paymentId}`);
    } catch (e) {
      fail(e);
    }
  });
sol
  .command("pay <url>")
  .description("Fetch a URL and pay in USDC on Solana if it answers 402 with a Solana option (x402 exact scheme, facilitator pays the fee)")
  .option("-X, --method <method>", "HTTP method", "GET")
  .option("-d, --data <body>", "request body")
  .option("-H, --header <header...>", "extra headers, Name: value")
  .option("--max <usdc>", "ceiling for this payment in USDC")
  .option("--dry-run", "show the 402 requirements without paying")
  .action(async (url: string, o: { method: string; data?: string; header?: string[]; max?: string; dryRun?: boolean }) => {
    try {
      const headers: Record<string, string> = {};
      for (const h of o.header ?? []) { const i = h.indexOf(":"); if (i > 0) headers[h.slice(0, i).trim()] = h.slice(i + 1).trim(); }
      const r = await payFetchSolana(url, { method: o.method, body: o.data, headers, maxUsdc: o.max ? Number(o.max) : undefined, dryRun: !!o.dryRun });
      if (o.dryRun) return out({ status: r.response.status, requirement: r.requirement ?? null, body: r.text.slice(0, 2000) });
      out({ status: r.response.status, receipt: r.receipt ?? null, body: r.text.slice(0, 4000) });
    } catch (e) {
      fail(e);
    }
  });
sol
  .command("burn <amount>")
  .description("Burn Rialto on Solana from this wallet (BurnChecked, supply shrinks for good). Irreversible")
  .option("--mint <mint>", "another mint than the configured Rialto mint")
  .option("--yes", "skip the confirmation line")
  .action(async (amount: string, o: { mint?: string; yes?: boolean }) => {
    try {
      const n = Number(amount);
      if (!Number.isFinite(n) || n <= 0) throw new Error("amount must be a positive number");
      if (!o.yes) throw new Error(`This burns ${n} tokens from this wallet on Solana and cannot be undone. Add --yes to confirm.`);
      out(await burnSpl(n, o.mint));
    } catch (e) {
      fail(e);
    }
  });
sol
  .command("stock <symbol>")
  .description("Tokenized stock on Solana (xStocks: AAPLx, TSLAx, NVDAx...): mint, USD price, deepest pool")
  .action(async (symbol: string) => {
    try {
      out(await solStock(symbol));
    } catch (e) {
      fail(e);
    }
  });
sol
  .command("receipts")
  .description("Every payment this kit signed (x402 on Solana, Venice top-ups): totals, by host, the last N, from ~/.rialto/receipts.jsonl")
  .option("-n, --limit <n>", "how many recent payments to list", "20")
  .option("--since <date>", "only payments at or after this ISO date")
  .option("--json", "raw JSON")
  .action((o: { limit: string; since?: string; json?: boolean }) => {
    try {
      const s = receiptsSummary({ limit: Number(o.limit), since: o.since });
      if (o.json) return out(s);
      console.log(`${s.settled} settled payment${s.settled === 1 ? "" : "s"} (${s.count} recorded), ${s.totalUsdc} USDC total, ${s.todayUsdc} USDC today. Ledger: ${s.path}`);
      for (const [host, h] of Object.entries(s.byHost).sort((a, b) => b[1].usdc - a[1].usdc)) console.log(`  ${host.padEnd(28)} ${String(h.count).padStart(4)} payment${h.count === 1 ? " " : "s"}  ${h.usdc} USDC`);
      if (s.last.length) console.log("");
      for (const r of s.last) console.log(`${r.at.slice(0, 19).replace("T", " ")}  ${r.kind.padEnd(5)} ${String(r.amountUsdc).padStart(10)} USDC  ${r.status < 400 ? "ok " : r.status}  ${r.host}${r.signature ? "  " + r.signature : r.ref ? "  " + r.ref : ""}`);
    } catch (e) {
      fail(e);
    }
  });
sol
  .command("watch")
  .description("Follow the Solana side live: slot, this wallet's SOL, USDC and Rialto, and the Rialto trade tape")
  .option("-e, --every <seconds>", "poll interval, minimum 5", "15")
  .option("--json", "one JSON object per line")
  .option("--once", "one pass, then exit")
  .action(async (o: { every: string; json?: boolean; once?: boolean }) => {
    try {
      const every = Math.max(5, Number(o.every)) * 1000;
      let last: { sol: number; usdc: number; rialto: number | null } | null = null;
      let seen = new Set<string>();
      let first = true;
      const stamp = () => new Date().toISOString().slice(11, 19);
      const say = (ev: Record<string, unknown>, line: string) => (o.json ? console.log(JSON.stringify({ at: new Date().toISOString(), ...ev })) : console.log(`${stamp()}  ${line}`));
      if (!o.json) console.error(`watching Solana every ${every / 1000} s. Ctrl-C to stop.`);
      for (;;) {
        try {
          const st = await solStatus();
          say({ type: "slot", slot: st.slot }, `slot ${st.slot.toLocaleString("en-US")}`);
          const now = { sol: st.sol, usdc: st.usdc, rialto: st.rialto };
          if (last) for (const k of ["sol", "usdc", "rialto"] as const) if (now[k] !== last[k]) say({ type: "wallet", field: k, before: last[k], after: now[k] }, `wallet ${k.toUpperCase()} ${last[k]} → ${now[k]}`);
          last = now;
          if (st.mint) {
            const t = await solTrades(st.mint, 40).catch(() => null);
            if (t) {
              const fresh = t.trades.filter((x) => !seen.has(x.tx));
              if (!first) for (const x of [...fresh].reverse()) say({ type: "trade", ...x }, `${x.kind === "buy" ? "BUY " : "SELL"} ${x.usd.toFixed(2)} Rialto @ ${x.priceUsd}  ${x.explorerUrl}`);
              seen = new Set(t.trades.map((x) => x.tx));
            }
          }
        } catch (e) {
          say({ type: "error", message: (e as Error).message }, `error: ${(e as Error).message}`);
        }
        first = false;
        if (o.once) return;
        await new Promise((r) => setTimeout(r, every));
      }
    } catch (e) {
      fail(e);
    }
  });
sol
  .command("address")
  .description("Print this Solana wallet's public key")
  .action(() => {
    try {
      out(getSolanaKeypair().publicKey.toBase58());
    } catch (e) {
      fail(e);
    }
  });

program
  .command("chain")
  .description("Robinhood Chain status")
  .action(async () => {
    try {
      out(await chainStatus());
    } catch (e) {
      fail(e);
    }
  });

program
  .command("wallet <address>")
  .description("Read-only report on any Robinhood Chain wallet")
  .action(async (address: string) => {
    try {
      out(await analyzeWallet(address));
    } catch (e) {
      fail(e);
    }
  });

const stocks = program.command("stocks").description("Tokenized stocks on Robinhood Chain");
stocks
  .command("price <symbol>")
  .description("USD price of a stock token (ticker or address)")
  .action(async (symbol: string) => {
    try {
      out(await stockPrice(symbol));
    } catch (e) {
      fail(e);
    }
  });
stocks
  .command("find <ticker>")
  .description("Discover official Robinhood stock tokens for a ticker")
  .action(async (ticker: string) => {
    try {
      out(await findStock(ticker));
    } catch (e) {
      fail(e);
    }
  });
stocks
  .command("list")
  .description("Known stock tokens (seed registry)")
  .action(() => out(STOCK_REGISTRY));
stocks
  .command("pools")
  .description("Top pools on Robinhood Chain by 24h volume")
  .option("-n, --limit <n>", "how many", "10")
  .action(async (o: { limit: string }) => {
    try {
      out(await topPools(Number(o.limit)));
    } catch (e) {
      fail(e);
    }
  });

program
  .command("send <to> <amount>")
  .description("Send USDG from the Rialto wallet (irreversible)")
  .action(async (to: string, amount: string) => {
    try {
      out(await sendUsdg(to, amount));
    } catch (e) {
      fail(e);
    }
  });

program
  .command("pay <url>")
  .description("Fetch a URL and pay in USDG on Robinhood Chain if it answers 402")
  .option("-X, --method <method>", "HTTP method", "GET")
  .option("-d, --data <body>", "request body")
  .option("--max <usdg>", "per-payment ceiling for this call")
  .option("--dry-run", "read the payment requirements without paying")
  .option("--burn", "pay in Rialto by burning the amount the 402 names (rialto.casa lane), instead of USDG")
  .action(async (url: string, o: { method: string; data?: string; max?: string; dryRun?: boolean; burn?: boolean }) => {
    try {
      const r = await payFetch(url, { method: o.method, body: o.data, maxUsdg: o.max ? Number(o.max) : undefined, dryRun: o.dryRun, burn: o.burn });
      out({ status: r.response.status, requirement: r.requirement, receipt: r.receipt });
      out(r.text);
    } catch (e) {
      fail(e);
    }
  });

program
  .command("quote <amountUsdg>")
  .description("Quote USDG (Robinhood Chain) to USDC (Base) through Relay, no transaction")
  .action(async (amount: string) => {
    try {
      const q = await bestQuote(amount, getAccount().address);
      out({ provider: q.provider, expectedUsdc: q.expectedUsdc, timeEstimateSeconds: q.timeEstimateSeconds });
    } catch (e) {
      fail(e);
    }
  });

program
  .command("bridge <amountUsdg>")
  .description("Move USDG from Robinhood Chain to USDC on Base (same wallet) without topping up Venice")
  .action(async (amount: string) => {
    try {
      out(await bridgeUsdgToBase(amount, (m) => console.error(m)));
      out(`USDC on Base: ${BASE_USDC_ADDRESS}`);
    } catch (e) {
      fail(e);
    }
  });

program
  .command("fund <amountUsdg>")
  .description("Bridge USDG to USDC on Base and top up Venice credit (minimum 5 USDG)")
  .action(async (amount: string) => {
    try {
      out(await fundVenice(amount, (m) => console.error(m)));
    } catch (e) {
      fail(e);
    }
  });

program
  .command("topup <amountUsd>")
  .description("Top up Venice from USDC already on Base")
  .action(async (amount: string) => {
    try {
      out(await topUp(Number(amount)));
    } catch (e) {
      fail(e);
    }
  });

const venice = program.command("venice").description("Venice AI");
venice
  .command("balance")
  .description("Venice credit balance for the wallet")
  .action(async () => {
    try {
      out(await veniceBalance());
    } catch (e) {
      fail(e);
    }
  });
venice
  .command("ledger")
  .description("Recent Venice ledger entries")
  .option("-n, --limit <n>", "how many", "20")
  .action(async (o: { limit: string }) => {
    try {
      out(await transactions(Number(o.limit)));
    } catch (e) {
      fail(e);
    }
  });
venice
  .command("models")
  .description("Venice text models with pricing")
  .action(async () => {
    try {
      out((await listModels("text")).map((m) => ({ id: m.id, traits: m.model_spec?.traits, pricing: m.model_spec?.pricing })));
    } catch (e) {
      fail(e);
    }
  });
venice
  .command("search <query>")
  .description("Private web search through Venice")
  .action(async (query: string) => {
    try {
      out(await webSearch(query));
    } catch (e) {
      fail(e);
    }
  });

program
  .command("chat <prompt>")
  .description("Ask a Venice model, paid from the wallet's Venice credit")
  .option("-m, --model <model>", "model id")
  .option("--web", "enable web search")
  .action(async (prompt: string, o: { model?: string; web?: boolean }) => {
    try {
      const r = await chat([{ role: "user", content: prompt }], { model: o.model, webSearch: o.web ? "auto" : "off" });
      out(r.content);
      if (r.balanceRemainingUsd !== null) console.error(`venice balance: ${r.balanceRemainingUsd} USD`);
    } catch (e) {
      fail(e);
    }
  });

program
  .command("agent <goal>")
  .description("Run the budgeted reference agent")
  .option("-b, --budget <usd>", "hard budget in USD")
  .option("--cap <tool=usd>", "per-tool cap for this run, repeatable (sol_pay=0.05, venice=0.03)", (v: string, acc: string[]) => [...acc, v], [] as string[])
  .option("-s, --steps <n>", "max steps", "8")
  .option("-m, --model <model>", "model id")
  .option("--web", "allow web search")
  .action(async (goal: string, o: { budget?: string; cap: string[]; steps: string; model?: string; web?: boolean }) => {
    try {
      const r = await runAgent(goal, {
        budgetUsd: o.budget ? Number(o.budget) : undefined,
        toolCaps: o.cap.length ? parseToolCaps(o.cap) : undefined,
        maxSteps: Number(o.steps),
        model: o.model,
        webSearch: o.web,
        onEvent: (e) => {
          if (e.type === "tool") console.error(`[tool] ${e.name}(${JSON.stringify(e.args)}) ${e.ms}ms`);
          else if (e.type === "budget") console.error(`[budget] spent ${e.spentUsd.toFixed(4)} / ${e.budgetUsd} USD`);
          else if (e.type === "cap") console.error(`[cap] ${e.tool} ${e.spentUsd.toFixed(4)} / ${e.capUsd} USD`);
          else if (e.type === "stop") console.error(`[stop] ${e.reason}`);
        },
      });
      out(r.answer);
      console.error(`spent ${r.spentUsd.toFixed(4)} USD in ${r.steps} steps` + (Object.keys(r.spentByTool).length ? ` (${Object.entries(r.spentByTool).map(([k, v]) => `${k} ${v.toFixed(4)}`).join(", ")})` : ""));
    } catch (e) {
      fail(e);
    }
  });

program
  .command("mcp")
  .description("Start the Rialto MCP server on stdio")
  .action(async () => {
    try {
      await serveStdio();
    } catch (e) {
      fail(e);
    }
  });

program
  .command("skill")
  .description("Print the Rialto SKILL.md for coding agents")
  .action(() => {
    out(readFileSync(join(here, "..", "SKILL.md"), "utf8"));
  });

program
  .command("config [key] [value]")
  .description("Read or write config (defaultModel, agentBudgetUsd, maxPaymentUsdg, payAllowlist, toolCaps, veniceApiKey)")
  .action((key?: string, value?: string) => {
    const cfg = readConfig();
    if (!key) return out({ ...cfg, privateKey: cfg.privateKey ? "(set)" : undefined, veniceApiKey: cfg.veniceApiKey ? "(set)" : undefined });
    if (value === undefined) return out((cfg as Record<string, unknown>)[key] ?? null);
    const parsed = key === "payAllowlist" ? value.split(",").map((s) => s.trim()).filter(Boolean) : key === "toolCaps" ? parseToolCaps(value) : /^\d+(\.\d+)?$/.test(value) ? Number(value) : value;
    writeConfig({ ...cfg, [key]: parsed });
    out(`set ${key}`);
  });

program.parseAsync(process.argv).catch(fail);
