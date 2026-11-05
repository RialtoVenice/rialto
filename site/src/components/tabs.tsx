import { useEffect, useState, type ReactNode } from "react";

/** Small client-side tab strip. One panel on screen at a time; the strip scrolls on narrow screens. */
export function Tabs({ tabs, initial = 0, id }: { tabs: { key: string; label: string; badge?: string; content: ReactNode }[]; initial?: number; id?: string }) {
  const [i, setI] = useState(initial);
  // #tab-<key> in the URL opens that tab, so a tab can be linked from a post.
  useEffect(() => {
    const pick = () => {
      const k = tabs.findIndex((t) => window.location.hash === `#tab-${t.key}`);
      if (k >= 0) {
        setI(k);
        document.getElementById(id ?? "")?.scrollIntoView({ block: "start" });
      }
    };
    pick();
    window.addEventListener("hashchange", pick);
    return () => window.removeEventListener("hashchange", pick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const active = tabs[Math.min(i, tabs.length - 1)];
  return (
    <div id={id}>
      <div role="tablist" className="-mx-6 flex gap-2 overflow-x-auto px-6 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {tabs.map((t, k) => (
          <button
            key={t.key}
            role="tab"
            type="button"
            aria-selected={k === i}
            onClick={() => setI(k)}
            className={`shrink-0 rounded-full border px-4 py-2 text-sm transition ${k === i ? "border-brick bg-brick text-white" : "border-line bg-panel text-ink hover:border-brick hover:text-brick"}`}
          >
            {t.label}
            {t.badge && <span className={`ml-2 font-mono text-xs ${k === i ? "text-white/80" : "text-ink-2"}`}>{t.badge}</span>}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="mt-5">{active.content}</div>
    </div>
  );
}
