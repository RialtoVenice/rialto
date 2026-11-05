import { useState } from "react";

/**
 * Token contract strip. With an address: a link to the explorer and a copy button. Without one (the Solana mint is not
 * out yet): a clear placeholder instead of an old address nobody should buy.
 */
export function CaBar({ address, explorer, chart, chain = "Solana", pending = "Contract address drops tomorrow. Only trust the one published here and on @RialtoVenice." }: { address?: string; explorer?: string; chart?: string; chain?: string; pending?: string }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setDone(true);
      setTimeout(() => setDone(false), 1200);
    } catch {
      /* clipboard unavailable */
    }
  };
  if (!address) {
    return (
      <div className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-brick/30 bg-brick-tint px-4 py-3">
        <span className="font-mono text-xs uppercase tracking-wider text-brick">Token CA · {chain}</span>
        <span className="min-w-0 text-sm text-ink">{pending}</span>
      </div>
    );
  }
  return (
    <div className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-brick/30 bg-brick-tint px-4 py-3">
      <span className="font-mono text-xs uppercase tracking-wider text-brick">Token CA · {chain}</span>
      <a href={explorer} target="_blank" rel="noopener" className="r-underline min-w-0 break-all font-mono text-sm text-ink" title={`Open on the ${chain} explorer`}>
        {address}
      </a>
      <div className="ml-auto flex items-center gap-2">
        <button type="button" onClick={copy} className="inline-flex items-center gap-1.5 rounded-xl bg-brick px-3 py-1.5 text-xs font-medium text-white transition hover:bg-brick-2 active:scale-[0.98]">
          {done ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12l5 5L20 7" /></svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 0 1 2-2h9" /></svg>
          )}
          {done ? "Copied" : "Copy CA"}
        </button>
        {chart && (
          <a href={chart} target="_blank" rel="noopener" className="r-underline text-xs font-medium text-ink">Chart</a>
        )}
      </div>
    </div>
  );
}
