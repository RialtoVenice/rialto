import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { getSol, type SolData } from "../lib/live.functions";
import { PRIMARY_ORIGIN } from "../lib/site";

/** Live: the slot, the Rialto tape and the last hour, polled from the Solana routes. */
export const Route = createFileRoute("/live")({
  loader: async () => getSol().catch(() => null),
  staleTime: 20_000,
  head: () => ({ meta: [{ title: "Rialto live" }, { name: "description", content: "Rialto on Solana, right now: slot, trade tape, last hour." }], links: [{ rel: "canonical", href: `${PRIMARY_ORIGIN}/live` }] }),
  component: Live,
});

type Trades = NonNullable<SolData["trades"]>;
type Chain = NonNullable<SolData["chain"]>;
const fmt = (n: number, d = 0) => n.toLocaleString("en-US", { maximumFractionDigits: d });

function usePoll<T>(url: string, everyMs: number, initial: T | null) {
  const [data, setData] = useState<T | null>(initial);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const run = async () => {
      if (typeof document !== "undefined" && document.hidden) return;
      try {
        const r = (await (await fetch(url)).json()) as { ok: boolean; data?: T; error?: string };
        if (!alive) return;
        if (r.ok && r.data) {
          setData(r.data);
          setErr(null);
        } else setErr(r.error ?? "unavailable");
      } catch (e) {
        if (alive) setErr((e as Error).message);
      }
    };
    const id = setInterval(run, everyMs);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [url, everyMs]);
  return { data, err };
}

function Live() {
  const initial = Route.useLoaderData() as SolData | null;
  const { data: chain } = usePoll<Chain>("/api/sol/chain", 15_000, initial?.chain ?? null);
  const { data: trades, err } = usePoll<Trades>("/api/sol/trades?limit=40", 20_000, initial?.trades ?? null);
  const mint = initial?.mint ?? null;
  return (
    <>
      <header className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Link to="/" className="font-semibold tracking-tight text-ink">Rialto</Link>
        <nav className="flex items-center gap-6 text-sm text-ink-2"><Link to="/docs" className="r-underline hover:text-ink">Docs</Link><Link to="/explore" className="r-underline hover:text-ink">Explore</Link><Link to="/status" className="r-underline hover:text-ink">Status</Link></nav>
      </header>
      <main className="mx-auto max-w-6xl px-6 pb-24 pt-10">
        <p className="font-mono text-xs uppercase tracking-wider text-brick">Live · Solana</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight text-ink">Rialto on Solana, right now</h1>
        <div className="mt-8 grid gap-6 md:grid-cols-3">
          <div className="rounded-xl border border-line bg-paper p-6"><p className="font-mono text-xs uppercase tracking-wider text-ink-2">Slot</p><p className="mt-2 text-3xl font-semibold tracking-tight text-ink">{chain ? fmt(chain.slot) : "…"}</p><p className="text-xs text-ink-2">{chain?.blockTime ? new Date(chain.blockTime * 1000).toISOString().slice(11, 19) + " UTC" : ""}</p></div>
          <div className="rounded-xl border border-line bg-paper p-6"><p className="font-mono text-xs uppercase tracking-wider text-ink-2">SOL</p><p className="mt-2 text-3xl font-semibold tracking-tight text-ink">{chain?.solPriceUsd ? `$${fmt(chain.solPriceUsd, 2)}` : "…"}</p><p className="text-xs text-ink-2">CoinGecko</p></div>
          <div className="rounded-xl border border-line bg-paper p-6"><p className="font-mono text-xs uppercase tracking-wider text-ink-2">Rialto, last hour</p><p className="mt-2 text-3xl font-semibold tracking-tight text-ink">{trades ? `${trades.lastHour.buys} / ${trades.lastHour.sells}` : "…"}</p><p className="text-xs text-ink-2">{trades ? `buys / sells · $${fmt(trades.lastHour.buyUsd)} in, $${fmt(trades.lastHour.sellUsd)} out` : mint ? "" : "the tape starts with the mint"}</p></div>
        </div>
        <div className="mt-8 rounded-xl border border-line bg-paper p-6">
          <div className="flex items-baseline justify-between"><p className="font-mono text-xs uppercase tracking-wider text-ink-2">Rialto tape{trades ? ` · ${trades.label}` : ""}</p><p className="font-mono text-xs text-ink-2">{trades ? `last $${trades.lastPriceUsd}` : ""}</p></div>
          {!mint ? (
            <p className="mt-3 text-sm text-ink-2">The mint is not published yet. The tape, the holders and the burns light up the moment it is.</p>
          ) : trades ? (
            <ul className="mt-3 divide-y divide-line">
              {trades.trades.map((t) => (
                <li key={t.tx} className="grid grid-cols-[auto_auto_1fr_auto_auto] items-baseline gap-4 py-2 text-sm"><span className="font-mono text-xs text-ink-2">{t.time.slice(11, 19)}</span><span className={t.kind === "buy" ? "font-mono text-emerald-700" : "font-mono text-brick"}>{t.kind.toUpperCase()}</span><span className="font-mono text-ink">${t.usd.toFixed(2)} <span className="text-ink-2">@ ${t.priceUsd}</span></span><span className="font-mono text-xs text-ink-2">{t.trader.slice(0, 4)}…{t.trader.slice(-4)}</span><a className="r-underline font-mono text-xs text-brick" href={t.explorerUrl} target="_blank" rel="noopener">tx</a></li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-ink-2">{err ?? "Loading the tape…"}</p>
          )}
        </div>
        <p className="mt-10 text-sm text-ink-2">Same data by hand: <code className="font-mono text-ink">curl {PRIMARY_ORIGIN}/api/sol/chain</code>, <code className="font-mono text-ink">/api/sol/trades?limit=40</code>, <code className="font-mono text-ink">/api/sol/holders</code>, <code className="font-mono text-ink">/api/sol/burns</code>.</p>
      </main>
    </>
  );
}
