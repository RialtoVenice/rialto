import { useState } from "react";

export function CopyCommand({ command, label = "Copy" }: { command: string; label?: string }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setDone(true);
      setTimeout(() => setDone(false), 1200);
    } catch {
      /* clipboard unavailable */
    }
  };
  return (
    <div className="flex w-full items-stretch overflow-hidden rounded-xl border border-line bg-code text-code-ink">
      <pre className="min-w-0 flex-1 whitespace-pre-wrap break-all px-4 py-3 font-mono text-[13px] leading-6 sm:text-sm">
        <code>{command}</code>
      </pre>
      <button
        type="button"
        onClick={copy}
        aria-label={`${label} command`}
        className="flex shrink-0 items-center gap-2 border-l border-white/10 px-4 font-mono text-xs text-code-ink/80 transition hover:bg-white/5 hover:text-code-ink active:scale-[0.98]"
      >
        {done ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 12l5 5L20 7" />
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="9" y="9" width="11" height="11" rx="2" />
            <path d="M5 15V6a2 2 0 0 1 2-2h9" />
          </svg>
        )}
        {done ? "Copied" : label}
      </button>
    </div>
  );
}
