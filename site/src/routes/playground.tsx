import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { createSiweMessage } from "viem/siwe";
import { CopyCommand } from "../components/copy-command";
import { PRIMARY_ORIGIN } from "../lib/site";

export const Route = createFileRoute("/playground")({
  head: () => ({
    meta: [
      { title: "Rialto playground" },
      { name: "description", content: "Talk to a private Venice AI model from your own wallet, in the browser. No account, no API key, no server-side key." },
    ],
    links: [{ rel: "canonical", href: `${PRIMARY_ORIGIN}/playground` }],
  }),
  component: Playground,
});

const VENICE_CHAT_URL = "https://api.venice.ai/api/v1/chat/completions";
const MODELS = ["zai-org-glm-5-2", "llama-3.3-70b", "qwen3-235b-a22b-instruct-2507", "venice-uncensored", "deepseek-v3.2"];
type Msg = { role: "user" | "assistant"; content: string; meta?: string; citations?: { url: string; title?: string }[] };
type Eip1193 = { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> };

const toHex = (s: string) => "0x" + Array.from(new TextEncoder().encode(s), (b) => b.toString(16).padStart(2, "0")).join("");
const randomNonce = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("");

async function signSiwx(eth: Eip1193, address: string): Promise<string> {
  const now = new Date();
  const message = createSiweMessage({ domain: "api.venice.ai", address: address as `0x${string}`, statement: "Sign in to Venice AI", uri: VENICE_CHAT_URL, version: "1", chainId: 8453, nonce: randomNonce(), issuedAt: now, expirationTime: new Date(now.getTime() + 5 * 60_000) });
  const signature = (await eth.request({ method: "personal_sign", params: [toHex(message), address] })) as string;
  return btoa(JSON.stringify({ address, message, signature, timestamp: now.getTime(), chainId: 8453 }));
}

function Playground() {
  const [address, setAddress] = useState<string | null>(null);
  const [model, setModel] = useState(MODELS[0]);
  const [live, setLive] = useState(true);
  const [web, setWeb] = useState(false);
  const [input, setInput] = useState("What does my wallet hold, and what is NVDA at right now?");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [needsCredit, setNeedsCredit] = useState(false);

  const eth = () => (window as unknown as { ethereum?: Eip1193 }).ethereum;

  const connect = async () => {
    const e = eth();
    if (!e) {
      setErr("No wallet found in this browser. Install one, or use the kit: rialto chat \"…\"");
      return;
    }
    setErr(null);
    try {
      const accounts = (await e.request({ method: "eth_requestAccounts" })) as string[];
      setAddress(accounts[0]);
    } catch (x) {
      setErr((x as Error).message);
    }
  };

  const send = async () => {
    const e = eth();
    const q = input.trim();
    if (!e || !address || !q) return;
    setErr(null);
    setNeedsCredit(false);
    const history = [...msgs, { role: "user" as const, content: q }];
    setMsgs(history);
    setInput("");
    try {
      setBusy("Sign the message in your wallet");
      const siwx = await signSiwx(e, address);
      setBusy("Venice is thinking");
      const r = await fetch("/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ siwx, messages: history.map(({ role, content }) => ({ role, content })), model, live, wallet: address, webSearch: web }) });
      const j = (await r.json()) as { ok: boolean; error?: string; data?: { content?: string; usage?: { prompt_tokens?: number; completion_tokens?: number }; balanceRemainingUsd: number | null; needsCredit?: boolean; citations?: { url: string; title?: string }[]; model?: string } };
      if (j.data?.balanceRemainingUsd !== undefined && j.data.balanceRemainingUsd !== null) setBalance(j.data.balanceRemainingUsd);
      if (!j.ok) {
        if (j.data?.needsCredit) setNeedsCredit(true);
        throw new Error(j.error ?? "request failed");
      }
      const u = j.data?.usage;
      const meta = [j.data?.model, u ? `${u.prompt_tokens ?? 0} in / ${u.completion_tokens ?? 0} out` : null, j.data?.balanceRemainingUsd !== null && j.data?.balanceRemainingUsd !== undefined ? `balance $${j.data.balanceRemainingUsd.toFixed(4)}` : null].filter(Boolean).join(" · ");
      setMsgs([...history, { role: "assistant", content: j.data?.content ?? "", meta, citations: j.data?.citations }]);
    } catch (x) {
      setErr((x as Error).message);
      setMsgs(history);
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <header className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Link to="/" className="font-semibold tracking-tight text-ink">Rialto</Link>
        <nav className="flex items-center gap-6 text-sm text-ink-2">
          <Link to="/live" className="r-underline hover:text-ink">Live</Link>
          <Link to="/explore" className="r-underline hover:text-ink">Explore</Link>
          <Link to="/docs" className="r-underline hover:text-ink">Docs</Link>
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-6 pb-24 pt-10">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-brick">Playground</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tighter text-ink md:text-5xl">Private AI, paid by your wallet</h1>
        <p className="mt-4 max-w-[62ch] text-ink-2">
          Talk to a Venice model from the browser. Your wallet signs Venice's login message for each request, this site forwards it once, and Venice bills your own credit. No account, no API key, and the server never holds a key or a balance.
        </p>

        <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_320px]">
          <div className="rounded-xl border border-line bg-panel p-4 md:p-6">
            <div className="min-h-[280px] space-y-4">
              {msgs.length === 0 && <p className="text-sm text-ink-2">Ask about the chain, your wallet, a stock token, or anything else. With live context on, the model sees current prices, the Rialto token and your holdings.</p>}
              {msgs.map((m, i) => (
                <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
                  <div className={`max-w-[85%] rounded-xl px-4 py-3 text-sm ${m.role === "user" ? "bg-brick text-white" : "border border-line bg-paper text-ink"}`}>
                    <p className="whitespace-pre-wrap">{m.content}</p>
                    {m.citations && m.citations.length > 0 && (
                      <ul className="mt-2 space-y-1 text-xs">
                        {m.citations.map((c) => <li key={c.url}><a className="r-underline text-brick" href={c.url} target="_blank" rel="noopener">{c.title ?? c.url}</a></li>)}
                      </ul>
                    )}
                    {m.meta && <p className="mt-2 font-mono text-[11px] text-ink-2">{m.meta}</p>}
                  </div>
                </div>
              ))}
              {busy && <p className="font-mono text-xs text-ink-2">{busy}…</p>}
            </div>
            {err && <p className="mt-4 rounded-xl border border-brick/30 bg-brick-tint px-4 py-3 text-sm text-ink">{err}</p>}
            {needsCredit && address && (
              <div className="mt-4 rounded-xl border border-line bg-paper p-4 text-sm text-ink-2">
                <p>This wallet has no Venice credit yet. Fund it from Solana with the kit (USDC in, credit out, same address):</p>
                <div className="mt-2"><CopyCommand command="rialto sol fund 5" /></div>
                <p className="mt-2">Or top up at venice.ai with USDC on Base for {address}.</p>
              </div>
            )}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void send();
              }}
              className="mt-4 flex flex-wrap gap-3"
            >
              <label className="sr-only" htmlFor="q">Message</label>
              <input id="q" value={input} onChange={(e) => setInput(e.target.value)} disabled={!address || !!busy} placeholder={address ? "Ask something" : "Connect a wallet first"} className="min-w-0 flex-1 rounded-xl border border-line bg-paper px-4 py-3 text-sm text-ink outline-none focus:border-brick disabled:opacity-60" />
              {address ? (
                <button type="submit" disabled={!!busy || !input.trim()} className="rounded-xl bg-brick px-5 py-3 text-sm font-medium text-white transition hover:bg-brick-2 active:scale-[0.98] disabled:opacity-60">Sign and send</button>
              ) : (
                <button type="button" onClick={connect} className="rounded-xl bg-brick px-5 py-3 text-sm font-medium text-white transition hover:bg-brick-2 active:scale-[0.98]">Connect wallet</button>
              )}
            </form>
          </div>

          <aside className="space-y-4">
            <div className="rounded-xl border border-line bg-panel p-5">
              <p className="font-mono text-xs uppercase tracking-wider text-ink-2">Wallet</p>
              <p className="mt-2 break-all font-mono text-xs text-ink">{address ?? "not connected"}</p>
              <p className="mt-2 text-sm text-ink-2">Venice credit: <span className="font-semibold text-ink">{balance === null ? "shown after the first request" : `$${balance.toFixed(4)}`}</span></p>
            </div>
            <div className="rounded-xl border border-line bg-panel p-5">
              <p className="font-mono text-xs uppercase tracking-wider text-ink-2">Model</p>
              <select value={model} onChange={(e) => setModel(e.target.value)} className="mt-2 w-full rounded-xl border border-line bg-paper px-3 py-2 font-mono text-xs text-ink outline-none focus:border-brick">
                {MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
              <label className="mt-4 flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} /> Live chain context (prices, Rialto, your holdings)</label>
              <label className="mt-2 flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={web} onChange={(e) => setWeb(e.target.checked)} /> Venice web search (costs a little more)</label>
            </div>
            <div className="rounded-xl border border-line bg-panel p-5 text-sm text-ink-2">
              <p className="font-mono text-xs uppercase tracking-wider text-ink-2">How it works</p>
              <ol className="mt-2 list-decimal space-y-1 pl-5">
                <li>Your wallet signs a plain SIWE message for api.venice.ai. One signature per request, five minute expiry, single use.</li>
                <li>This site forwards the request to Venice with that signature and returns the answer. It stores nothing.</li>
                <li>Venice deducts the cost from the credit of that address. Fund it with <code className="font-mono text-ink">rialto sol fund</code> from USDC on Solana.</li>
              </ol>
              <p className="mt-3">Prefer a terminal? <code className="font-mono text-ink">rialto chat "…"</code> does the same without popups.</p>
            </div>
          </aside>
        </div>
      </main>
    </>
  );
}
