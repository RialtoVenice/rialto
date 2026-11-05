import { useEffect, useState } from "react";
import type { Leaderboard, WalletRank } from "../lib/hood.server";

const fmt = (n: number, d = 0) => n.toLocaleString("en-US", { maximumFractionDigits: d });
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/**
 * "Your rank": type any wallet, get where it stands on the Rialto ledger, share it, embed the badge.
 * The leaderboard and cohort figures come from the loader; the card fetches /api/token/wallet/{address} on demand.
 */
export function RankCard({ board }: { board: Leaderboard | null }) {
  const [input, setInput] = useState("");
  const [rank, setRank] = useState<WalletRank | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    try {
      const last = window.localStorage.getItem("rialto.rank.address");
      if (last) setInput(last);
    } catch {
      // storage can be unavailable; the field simply starts empty
    }
  }, []);

  async function check(address: string) {
    const a = address.trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(a)) {
      setError("Paste a 0x address (42 characters).");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/token/wallet/${a}`);
      const body = (await res.json()) as { ok: boolean; data?: WalletRank; error?: string };
      if (!body.ok || !body.data) throw new Error(body.error ?? `HTTP ${res.status}`);
      setRank(body.data);
      try {
        window.localStorage.setItem("rialto.rank.address", a);
      } catch {
        // ignore
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const badgeMd = rank ? `[![Rialto](${rank.badgeUrl})](https://rialto.casa/#tab-rank)` : "";

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="rounded-xl border-2 border-brick/40 bg-paper p-6">
          <p className="font-mono text-xs uppercase tracking-wider text-brick">Your rank, from the ledger</p>
          <p className="mt-2 text-sm text-ink-2">Every wallet that ever held Rialto has a number, a rank and a record. Paste any address. Nothing to sign, nothing stored on the server.</p>
          <form
            className="mt-4 flex flex-col gap-2 sm:flex-row"
            onSubmit={(e) => {
              e.preventDefault();
              void check(input);
            }}
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="0x…"
              spellCheck={false}
              autoComplete="off"
              className="min-w-0 flex-1 rounded-lg border border-line bg-panel px-3 py-2.5 font-mono text-sm text-ink outline-none placeholder:text-ink-2/60 focus:border-brick"
              aria-label="Wallet address"
            />
            <button type="submit" disabled={busy} className="r-primary rounded-lg bg-brick px-5 py-2.5 text-sm font-medium text-white transition hover:bg-brick-2 disabled:opacity-60">
              {busy ? "Reading the ledger…" : "Check"}
            </button>
          </form>
          {error && <p className="mt-3 text-sm text-brick">{error}</p>}

          {rank && (
            <div className="mt-6 border-t border-line pt-6">
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <a className="r-underline font-mono text-sm text-ink" href={rank.explorerUrl} target="_blank" rel="noopener">{short(rank.address)}</a>
                {rank.label && <span className="font-mono text-xs text-ink-2">{rank.label}</span>}
                {rank.diamond && <span className="rounded-full bg-emerald-700/10 px-2.5 py-0.5 font-mono text-[11px] uppercase tracking-wider text-emerald-700">never sold</span>}
                {rank.dayOne && <span className="rounded-full bg-brick/10 px-2.5 py-0.5 font-mono text-[11px] uppercase tracking-wider text-brick">day one</span>}
                <span className="rounded-full border border-line px-2.5 py-0.5 font-mono text-[11px] uppercase tracking-wider text-ink-2">{rank.tier} tier</span>
              </div>
              <div className="mt-4 grid gap-4 sm:grid-cols-3">
                <div>
                  <p className="font-mono text-xs text-ink-2">Rank</p>
                  <p className="mt-1 text-3xl font-semibold tracking-tight text-ink">{rank.rank ? `#${fmt(rank.rank)}` : "—"}</p>
                  <p className="text-xs text-ink-2">{rank.rank ? `of ${fmt(rank.holders)} holders · top ${rank.topPct}%` : "holds no Rialto right now"}</p>
                </div>
                <div>
                  <p className="font-mono text-xs text-ink-2">Wallet number</p>
                  <p className="mt-1 text-3xl font-semibold tracking-tight text-ink">{rank.walletNo ? `#${fmt(rank.walletNo)}` : "—"}</p>
                  <p className="text-xs text-ink-2">{rank.walletNo ? `of ${fmt(rank.walletsEver)} wallets ever` : "never held Rialto"}</p>
                </div>
                <div>
                  <p className="font-mono text-xs text-ink-2">Held for</p>
                  <p className="mt-1 text-3xl font-semibold tracking-tight text-ink">{rank.daysHeld !== null ? `${rank.daysHeld} d` : "—"}</p>
                  <p className="text-xs text-ink-2">{rank.firstDay ? `since ${rank.firstDay}` : "no first transfer"}</p>
                </div>
              </div>
              <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
                <div><dt className="font-mono text-xs text-ink-2">Balance</dt><dd className="font-mono text-ink">{fmt(rank.balance)}</dd></div>
                <div><dt className="font-mono text-xs text-ink-2">Share of supply</dt><dd className="font-mono text-ink">{rank.sharePct}%</dd></div>
                <div><dt className="font-mono text-xs text-ink-2">Received</dt><dd className="font-mono text-ink">{fmt(rank.received)}</dd></div>
                <div><dt className="font-mono text-xs text-ink-2">Sent</dt><dd className="font-mono text-ink">{fmt(rank.sent)}{rank.burned > 0 ? ` (${fmt(rank.burned)} burned)` : ""}</dd></div>
              </dl>
              {rank.nextTier && <p className="mt-4 text-sm text-ink-2">{fmt(rank.nextTier.need)} more Rialto reaches the {rank.nextTier.name} tier.</p>}
              <div className="mt-5 flex flex-wrap items-center gap-3">
                <a href={rank.shareUrl} target="_blank" rel="noopener" className="r-primary inline-flex items-center rounded-lg bg-ink px-4 py-2 text-sm font-medium text-paper transition hover:opacity-90">Share on X</a>
                <img src={rank.badgeUrl} alt="Rialto badge" height={20} className="h-5" />
                <button
                  type="button"
                  className="r-underline font-mono text-xs text-brick"
                  onClick={() => {
                    void navigator.clipboard?.writeText(badgeMd).then(() => {
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1500);
                    });
                  }}
                >
                  {copied ? "copied" : "copy badge markdown"}
                </button>
              </div>
              <p className="mt-3 text-xs text-ink-2">Current to block {fmt(rank.asOfBlock)}. Same data: /api/token/wallet/{"{address}"}, MCP tool rialto_rank, CLI rialto rank.</p>
            </div>
          )}
        </div>

        <div className="rounded-xl border border-line bg-paper p-6">
          <p className="font-mono text-xs uppercase tracking-wider text-ink-2">The cohort, right now</p>
          {board ? (
            <dl className="mt-4 space-y-4">
              <div>
                <dt className="text-sm text-ink-2">Diamond hands</dt>
                <dd className="text-2xl font-semibold tracking-tight text-ink">{fmt(board.diamondHands)} <span className="text-sm font-medium text-ink-2">of {fmt(board.holders)} holders never sold</span></dd>
              </div>
              <div>
                <dt className="text-sm text-ink-2">Day one, still here</dt>
                <dd className="text-2xl font-semibold tracking-tight text-ink">{fmt(board.dayOneStillHolding)} <span className="text-sm font-medium text-ink-2">of the {fmt(board.dayOneWallets)} wallets from the first day</span></dd>
              </div>
              <div>
                <dt className="text-sm text-ink-2">Wallets ever</dt>
                <dd className="text-2xl font-semibold tracking-tight text-ink">{fmt(board.walletsEver)} <span className="text-sm font-medium text-ink-2">{fmt(board.exited)} exited, median holder {fmt(board.medianBalance)} Rialto</span></dd>
              </div>
            </dl>
          ) : (
            <p className="mt-2 text-sm text-ink-2">Cohort figures unavailable right now.</p>
          )}
          <p className="mt-4 text-xs text-ink-2">Counted from every transfer of the contract. A wallet is diamond hands when it holds and has never sent Rialto anywhere but the dead address.</p>
        </div>
      </div>

      {board && (
        <div className="rounded-xl border border-line bg-paper p-6">
          <div className="flex items-baseline justify-between gap-3">
            <p className="font-mono text-xs uppercase tracking-wider text-ink-2">Leaderboard</p>
            <p className="font-mono text-xs text-ink-2">block {fmt(board.asOfBlock)}</p>
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="font-mono text-xs uppercase tracking-wider text-ink-2">
                <tr><th className="py-2 pr-3 font-normal">#</th><th className="py-2 pr-3 font-normal">Wallet</th><th className="py-2 pr-3 font-normal">Balance</th><th className="py-2 pr-3 font-normal">Share</th><th className="py-2 pr-3 font-normal">Since</th><th className="py-2 font-normal">Wallet no.</th></tr>
              </thead>
              <tbody className="divide-y divide-line">
                {board.rows.map((r) => (
                  <tr key={r.address}>
                    <td className="py-2 pr-3 font-mono text-xs text-ink-2">{r.rank}</td>
                    <td className="py-2 pr-3">
                      <button type="button" className="r-underline font-mono text-xs text-ink" onClick={() => { setInput(r.address); void check(r.address); }}>{short(r.address)}</button>
                      {r.label && <span className="ml-2 text-xs text-ink-2">{r.label}</span>}
                      {r.diamond && <span className="ml-2 font-mono text-[10px] uppercase tracking-wider text-emerald-700">never sold</span>}
                      {r.dayOne && <span className="ml-2 font-mono text-[10px] uppercase tracking-wider text-brick">day one</span>}
                    </td>
                    <td className="py-2 pr-3 font-mono text-xs text-ink">{fmt(r.balance)}</td>
                    <td className="py-2 pr-3 font-mono text-xs text-ink-2">{r.sharePct}%</td>
                    <td className="py-2 pr-3 font-mono text-xs text-ink-2">{r.firstDay ?? "—"}</td>
                    <td className="py-2 font-mono text-xs text-ink-2">#{fmt(r.walletNo)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-ink-2">Pools and vaults appear as wallets too; the label says so when the server knows. Same data: /api/token/leaderboard</p>
        </div>
      )}
    </div>
  );
}
