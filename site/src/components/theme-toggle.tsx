import { useEffect, useState } from "react";

type Mode = "auto" | "light" | "dark";

/** Light by day, dark by night: follows the system unless the visitor picks one. Stored in localStorage. */
export function ThemeToggle() {
  const [mode, setMode] = useState<Mode>("auto");
  useEffect(() => {
    try {
      const saved = localStorage.getItem("rialto-mode") as Mode | null;
      if (saved === "light" || saved === "dark") setMode(saved);
    } catch {
      /* ignore */
    }
  }, []);
  const apply = (m: Mode) => {
    setMode(m);
    const root = document.documentElement;
    if (m === "auto") root.removeAttribute("data-mode");
    else root.setAttribute("data-mode", m);
    try {
      if (m === "auto") localStorage.removeItem("rialto-mode");
      else localStorage.setItem("rialto-mode", m);
    } catch {
      /* ignore */
    }
  };
  const next: Mode = mode === "auto" ? "dark" : mode === "dark" ? "light" : "auto";
  const label = mode === "auto" ? "Auto" : mode === "dark" ? "Dark" : "Light";
  return (
    <button type="button" onClick={() => apply(next)} title={`Theme: ${label}. Click for ${next}.`} className="rounded-full border border-line px-2.5 py-1 font-mono text-[11px] uppercase tracking-wider text-ink-2 transition hover:border-brick hover:text-brick">
      {mode === "dark" ? "☾" : mode === "light" ? "☀" : "◐"} {label}
    </button>
  );
}
