import { useEffect, useState } from "react";

type Rank = { address: string; balance: number; sharePct: number; rank: number | null; holders: number; topPct: number | null; complete: boolean; explorerUrl: string; shareText: string; shareUrl: string; asOfSlot: number };
type Wallet = { sol: number; usdc: number; rialto: number | null; rank: Rank | null };
const fmt = (n: number, d = 0) => n.toLocaleString("en-US", { maximumFractionDigits: d });
const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

/** "Your rank" on Solana: paste any address, read its balance and where it stands among holders. */
export function SolRankCard({ board }: { board: { holders: number | null; medianBalance: number; top10SharePct: number; rows: { rank: number; owner: string; amount: number; sharePct: number; label: string | null; explorerUrl: string }[]; asOfSlot: number } | null }) {
  const [input, setInput] = useState("");
  const [data, setData] = useState<Wallet | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    try {
      const last = window.localStorage.getItem("rialto.sol.address");
      if (last) setInput(last);
    } catch {
      /* ignore */
    }
  }, []);
  async function check(address: string) {
    const a = address.trim();
    if (a.length < 32 || a.length > 44) {
      setError("Paste a Solana address (base58).");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/sol/wallet/${a}`);
      const body = (await res.json()) as { ok: boolean; data?: Wallet; error?: string };
      if (!body.ok || !body.data) throw new Error(body.error ?? `HTTP ${res.status}`);
      setData(body.data);
      try {
        window.localStorage.setItem("rialto.sol.address", a);
      } catch {
        /* ignore */
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const r = data?.rank ?? null;
  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="rounded-xl border-2 border-brick/40 bg-paper p-6">
          <p className="font-mono text-xs uppercase tracking-wider text-brick">Your rank, from the chain</p>
          <p className="mt-2 text-sm text-ink-2">Paste any Solana address. Balance and rank come from a full scan of the mint's token accounts. Nothing to sign, nothing stored on the server.</p>
          <form className="mt-4 flex flex-col gap-2 sm:flex-row" onSubmit={(e) => { e.preventDefault(); void check(input); }}>
            <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Solana address" spellCheck={false} autoComplete="off" aria-label="Wallet address" className="min-w-0 flex-1 rounded-lg border border-line bg-panel px-3 py-2.5 font-mono text-sm text-ink outline-none placeholder:text-ink-2/60 focus:border-brick" />
            <button type="submit" disabled={busy} className="r-primary rounded-lg bg-brick px-5 py-2.5 text-sm font-medium text-white transition hover:bg-brick-2 disabled:opacity-60">{busy ? "Reading the chain…" : "Check"}</button>
          </form>
          {error && <p className="mt-3 text-sm text-brick">{error}</p>}
          {data && (
            <div className="mt-6 border-t border-line pt-6">
              <div className="grid gap-4 sm:grid-cols-3">
                <div><p className="font-mono text-xs text-ink-2">Rank</p><p className="mt-1 text-3xl font-semibold tracking-tight text-ink">{r?.rank ? `#${fmt(r.rank)}` : "—"}</p><p className="text-xs text-ink-2">{r?.rank ? `of ${fmt(r.holders)} holders · top ${r.topPct}%` : "holds no Rialto"}</p></div>
                <div><p className="font-mono text-xs text-ink-2">Rialto</p><p className="mt-1 text-3xl font-semibold tracking-tight text-ink">{data.rialto === null ? "—" : fmt(data.rialto)}</p><p className="text-xs text-ink-2">{r ? `${r.sharePct}% of supply` : ""}</p></div>
                <div><p className="font-mono text-xs text-ink-2">USDC · SOL</p><p className="mt-1 text-3xl font-semibold tracking-tight text-ink">{fmt(data.usdc, 2)}</p><p className="text-xs text-ink-2">{fmt(data.sol, 4)} SOL</p></div>
              </div>
              {r && (
                <div className="mt-5 flex flex-wrap items-center gap-3">
                  <a href={r.shareUrl} target="_blank" rel="noopener" className="r-primary inline-flex items-center rounded-lg bg-ink px-4 py-2 text-sm font-medium text-paper transition hover:opacity-90">Share on X</a>
                  <a href={r.explorerUrl} target="_blank" rel="noopener" className="r-underline font-mono text-xs text-brick">{short(r.address)} on Solscan</a>
                  <span className="font-mono text-xs text-ink-2">slot {fmt(r.asOfSlot)}</span>
                </div>
              )}
            </div>
          )}
        </div>
        <div className="rounded-xl border border-line bg-paper p-6">
          <p className="font-mono text-xs uppercase tracking-wider text-ink-2">The cohort, right now</p>
          {board ? (
            <dl className="mt-4 space-y-4">
              <div><dt className="text-sm text-ink-2">Holders</dt><dd className="text-2xl font-semibold tracking-tight text-ink">{board.holders === null ? "—" : fmt(board.holders)}</dd></div>
              <div><dt className="text-sm text-ink-2">Median holder</dt><dd className="text-2xl font-semibold tracking-tight text-ink">{fmt(board.medianBalance)} <span className="text-sm font-medium text-ink-2">Rialto</span></dd></div>
              <div><dt className="text-sm text-ink-2">Top 10 hold</dt><dd className="text-2xl font-semibold tracking-tight text-ink">{board.top10SharePct}%</dd></div>
            </dl>
          ) : (
            <p className="mt-2 text-sm text-ink-2">Cohort figures arrive with the mint.</p>
          )}
          <p className="mt-4 text-xs text-ink-2">Counted from every token account of the mint. Same data: /api/sol/leaderboard</p>
        </div>
      </div>
      {board && (
        <div className="rounded-xl border border-line bg-paper p-6">
          <div className="flex items-baseline justify-between gap-3"><p className="font-mono text-xs uppercase tracking-wider text-ink-2">Leaderboard</p><p className="font-mono text-xs text-ink-2">slot {fmt(board.asOfSlot)}</p></div>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[480px] text-left text-sm">
              <thead className="font-mono text-xs uppercase tracking-wider text-ink-2"><tr><th className="py-2 pr-3 font-normal">#</th><th className="py-2 pr-3 font-normal">Wallet</th><th className="py-2 pr-3 font-normal">Rialto</th><th className="py-2 font-normal">Share</th></tr></thead>
              <tbody className="divide-y divide-line">
                {board.rows.map((x) => (
                  <tr key={x.owner}>
                    <td className="py-2 pr-3 font-mono text-xs text-ink-2">{x.rank}</td>
                    <td className="py-2 pr-3"><button type="button" className="r-underline font-mono text-xs text-ink" onClick={() => { setInput(x.owner); void check(x.owner); }}>{short(x.owner)}</button>{x.label && <span className="ml-2 text-xs text-ink-2">{x.label}</span>}</td>
                    <td className="py-2 pr-3 font-mono text-xs text-ink">{fmt(x.amount)}</td>
                    <td className="py-2 font-mono text-xs text-ink-2">{x.sharePct}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
