import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PRIMARY_ORIGIN } from "../lib/site";

/** Status: what Rialto on Solana depends on, probed from the browser through the site's own routes. */
export const Route = createFileRoute("/status")({
  head: () => ({ meta: [{ title: "Rialto status" }, { name: "description", content: "Health of the Solana RPC, GeckoTerminal and Venice behind Rialto." }], links: [{ rel: "canonical", href: `${PRIMARY_ORIGIN}/status` }] }),
  component: Status,
});

type Probe = { name: string; url: string; ok: boolean | null; ms: number | null; note: string };

function Status() {
  const [probes, setProbes] = useState<Probe[]>([
    { name: "Solana RPC (through the site)", url: "/api/sol/chain", ok: null, ms: null, note: "" },
    { name: "GeckoTerminal", url: "https://api.geckoterminal.com/api/v2/networks/solana/dexes?page=1", ok: null, ms: null, note: "" },
    { name: "Venice x402 top-up discovery", url: "https://api.venice.ai/api/v1/x402/top-up", ok: null, ms: null, note: "" },
  ]);
  useEffect(() => {
    let alive = true;
    const run = async () => {
      const next = await Promise.all(
        probes.map(async (p) => {
          const t0 = performance.now();
          try {
            const res = await fetch(p.url, { method: p.url.includes("venice") ? "POST" : "GET" });
            const ms = Math.round(performance.now() - t0);
            if (p.url.startsWith("/api")) {
              const j = (await res.json()) as { ok: boolean; data?: { slot: number; rpc: string } };
              return { ...p, ok: j.ok, ms, note: j.data ? `slot ${j.data.slot.toLocaleString("en-US")} · ${j.data.rpc}` : "no data" };
            }
            if (p.url.includes("venice")) return { ...p, ok: res.status === 402, ms, note: res.status === 402 ? "answers 402 with payment options, as expected" : `HTTP ${res.status}` };
            return { ...p, ok: res.ok, ms, note: `HTTP ${res.status}` };
          } catch (e) {
            return { ...p, ok: false, ms: Math.round(performance.now() - t0), note: (e as Error).message };
          }
        }),
      );
      if (alive) setProbes(next);
    };
    void run();
    const id = setInterval(run, 30_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <>
      <header className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Link to="/" className="font-semibold tracking-tight text-ink">Rialto</Link>
        <nav className="flex items-center gap-6 text-sm text-ink-2"><Link to="/docs" className="r-underline hover:text-ink">Docs</Link><Link to="/live" className="r-underline hover:text-ink">Live</Link><Link to="/explore" className="r-underline hover:text-ink">Explore</Link></nav>
      </header>
      <main className="mx-auto max-w-3xl px-6 pb-24 pt-10">
        <p className="font-mono text-xs uppercase tracking-wider text-brick">Status · Solana</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight text-ink">What Rialto depends on</h1>
        <ul className="mt-8 divide-y divide-line rounded-xl border border-line bg-paper">
          {probes.map((p) => (
            <li key={p.name} className="grid grid-cols-[auto_1fr_auto] items-baseline gap-4 px-5 py-4 text-sm"><span className={`font-mono text-xs ${p.ok === null ? "text-ink-2" : p.ok ? "text-emerald-700" : "text-brick"}`}>{p.ok === null ? "…" : p.ok ? "OK" : "DOWN"}</span><span><span className="text-ink">{p.name}</span><span className="block text-xs text-ink-2">{p.note}</span></span><span className="font-mono text-xs text-ink-2">{p.ms === null ? "" : `${p.ms} ms`}</span></li>
          ))}
        </ul>
        <p className="mt-6 text-sm text-ink-2">Probed from your browser every 30 seconds. The RPC probe goes through the site, so it shows what the server sees; set SOLANA_RPC_URL on the host for a private endpoint.</p>
      </main>
    </>
  );
}
