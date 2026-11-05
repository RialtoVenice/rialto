import { createFileRoute, Link } from "@tanstack/react-router";
import { SolRankCard } from "../components/sol-rank-card";
import { getSol, type SolData } from "../lib/live.functions";
import { PRIMARY_ORIGIN } from "../lib/site";

/** Explore: any Solana wallet's standing on the Rialto ledger, and the leaderboard. */
export const Route = createFileRoute("/explore")({
  loader: async () => getSol().catch(() => null),
  staleTime: 60_000,
  head: () => ({ meta: [{ title: "Rialto explore" }, { name: "description", content: "Any Solana wallet's Rialto balance and rank, and the leaderboard." }], links: [{ rel: "canonical", href: `${PRIMARY_ORIGIN}/explore` }] }),
  component: () => {
    const sol = Route.useLoaderData() as SolData | null;
    return (
      <>
        <header className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <Link to="/" className="font-semibold tracking-tight text-ink">Rialto</Link>
          <nav className="flex items-center gap-6 text-sm text-ink-2"><Link to="/docs" className="r-underline hover:text-ink">Docs</Link><Link to="/live" className="r-underline hover:text-ink">Live</Link><Link to="/status" className="r-underline hover:text-ink">Status</Link></nav>
        </header>
        <main className="mx-auto max-w-6xl px-6 pb-24 pt-10">
          <p className="font-mono text-xs uppercase tracking-wider text-brick">Explore · Solana</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight text-ink">Where does a wallet stand?</h1>
          <div className="mt-8"><SolRankCard board={sol?.board ?? null} /></div>
          {!sol?.mint && <p className="mt-6 text-sm text-ink-2">The Rialto mint is not published yet; balances and ranks fill in the moment it is. USDC and SOL balances already work for any address.</p>}
        </main>
      </>
    );
  },
});
