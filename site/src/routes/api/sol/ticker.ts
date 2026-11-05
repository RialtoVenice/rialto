import { createFileRoute } from "@tanstack/react-router";
import { solBurns, solChain, solHolders, solTokenStats, solTrades } from "../../../lib/sol.server";
import { cors, guard } from "../../../lib/json.server";

/** The strip under the header, as items, so one poll replaces four. */
export const Route = createFileRoute("/api/sol/ticker")({
  server: {
    handlers: {
      GET: ({ request }) =>
        guard(async () => {
          const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });
          const [chain, st, holders, burns, trades] = await Promise.all([solChain().catch(() => null), solTokenStats().catch(() => null), solHolders(undefined, 1).catch(() => null), solBurns(undefined, 60).catch(() => null), solTrades(undefined, 5).catch(() => null)]);
          const items: { k: string; v: string; tone?: "brick" | "up" | "down" }[] = [];
          if (chain) items.push({ k: "slot", v: fmt(chain.slot) });
          if (st?.priceUsd) items.push({ k: "Rialto", v: `$${st.priceUsd.toLocaleString("en-US", { maximumSignificantDigits: st.priceUsd < 1 ? 4 : 6 })}`, tone: "brick" });
          if (st && st.change24hPct !== null) items.push({ k: "24h", v: `${st.change24hPct > 0 ? "+" : ""}${st.change24hPct}%`, tone: st.change24hPct >= 0 ? "up" : "down" });
          if (st?.volume24hUsd) items.push({ k: "24h volume", v: `$${fmt(st.volume24hUsd)}` });
          if (st?.liquidityUsd) items.push({ k: "liquidity", v: `$${fmt(st.liquidityUsd)}` });
          if (holders?.holders) items.push({ k: "holders", v: fmt(holders.holders) });
          if (burns) items.push({ k: "burned", v: `${fmt(burns.burnedTotal)} (${burns.burnedPctOfCurrentSupply ?? 0}%)`, tone: "brick" });
          if (trades) items.push({ k: "last hour", v: `${trades.lastHour.buys} buys / ${trades.lastHour.sells} sells`, tone: trades.lastHour.buys >= trades.lastHour.sells ? "up" : "down" });
          return { items, fetchedAt: new Date().toISOString() };
        }, request),
      OPTIONS: () => cors(),
    },
  },
});
