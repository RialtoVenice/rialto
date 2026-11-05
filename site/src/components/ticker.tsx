import { useEffect, useState } from "react";

type Item = { k: string; v: string; tone?: "up" | "down" | "brick" };

/**
 * Thin live strip under the header: latest block, USDG moved, Rialto price and 24h change, holders, burned, last burn,
 * last paid call. Polls the public API every 20 seconds and scrolls when it does not fit.
 */
export function Ticker({ initial, endpoint }: { initial: Item[]; endpoint?: string }) {
  const [items, setItems] = useState<Item[]>(initial);
  useEffect(() => {
    let alive = true;
    const run = async () => {
      // A hidden tab has nobody to show the strip to: skip the four calls until it is visible again.
      if (typeof document !== "undefined" && document.hidden) return;
      try {
        if (endpoint) {
          const r = await fetch(endpoint).then((x) => x.json()).catch(() => null);
          const items = (r?.data?.items ?? null) as Item[] | null;
          if (alive && items?.length) setItems(items);
          return;
        }
        const [pulse, token, burns, fly] = await Promise.all([
          fetch("/api/live/pulse").then((r) => r.json()).catch(() => null),
          fetch("/api/token").then((r) => r.json()).catch(() => null),
          fetch("/api/token/burns").then((r) => r.json()).catch(() => null),
          fetch("/api/flywheel").then((r) => r.json()).catch(() => null),
        ]);
        if (!alive) return;
        const next: Item[] = [];
        const p = pulse?.data;
        const t = token?.data;
        const b = burns?.data;
        const f = fly?.data;
        if (p?.latestBlock) next.push({ k: "block", v: Number(p.latestBlock.number).toLocaleString("en-US") });
        if (p?.usdg) next.push({ k: `USDG moved, ${p.usdg.blocks} blocks`, v: `$${Math.round(p.usdg.volumeUsdg).toLocaleString("en-US")}` });
        if (t?.priceUsd) next.push({ k: "Rialto", v: `$${Number(t.priceUsd).toLocaleString("en-US", { maximumSignificantDigits: 4 })}`, tone: "brick" });
        if (t?.volume24hUsd) next.push({ k: "24h volume", v: `$${Math.round(t.volume24hUsd).toLocaleString("en-US")}` });
        if (t?.volume?.sinceLaunchUsd) next.push({ k: `since launch, ${t.volume.partial ? `${t.volume.poolsCounted} of ` : ""}${t.volume.pools} pools`, v: `$${Math.round(t.volume.sinceLaunchUsd).toLocaleString("en-US")}` });
        if (p?.rialto?.lastHour) next.push({ k: "last hour", v: `${p.rialto.lastHour.buys} buys / ${p.rialto.lastHour.sells} sells`, tone: p.rialto.lastHour.buys >= p.rialto.lastHour.sells ? "up" : "down" });
        if (b) next.push({ k: "burned", v: `${Number(b.burnedTotal).toLocaleString("en-US")} (${b.burnedPct}%)`, tone: "brick" });
        if (b?.burns?.[0]) next.push({ k: "last burn", v: `${Math.round(b.burns[0].amountNum).toLocaleString("en-US")} Rialto` });
        if (f) next.push({ k: "x402 revenue", v: `${f.revenue.usdgTotal} USDG · ${f.revenue.payments} calls` });
        if (next.length) setItems(next);
      } catch {
        /* keep the last good strip */
      }
    };
    void run();
    const id = setInterval(run, 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);
  if (items.length === 0) return null;
  const row = items.map((it, i) => (
    <span key={it.k + i} className="inline-flex items-baseline gap-2 whitespace-nowrap px-5">
      <span className="font-mono text-[11px] uppercase tracking-wider text-ink-2">{it.k}</span>
      <span className={`font-mono text-xs ${it.tone === "up" ? "text-emerald-700" : it.tone === "down" || it.tone === "brick" ? "text-brick" : "text-ink"}`}>{it.v}</span>
    </span>
  ));
  return (
    <div className="r-ticker border-y border-line bg-panel" aria-live="off">
      <div className="r-ticker-track">
        <div className="r-ticker-row">{row}</div>
        <div className="r-ticker-row" aria-hidden="true">{row}</div>
      </div>
    </div>
  );
}
