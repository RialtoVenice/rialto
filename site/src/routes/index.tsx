import { createFileRoute, Link } from "@tanstack/react-router";
import { CopyCommand } from "../components/copy-command";
import { CaBar } from "../components/ca-bar";
import { ThemeToggle } from "../components/theme-toggle";
import { StructuredData } from "../components/StructuredData";
import { HeroScene } from "../components/hero-scene";
import { getOrigin, getSol, type SolData } from "../lib/live.functions";
import { Tabs } from "../components/tabs";
import { Ticker } from "../components/ticker";
import { SolRankCard } from "../components/sol-rank-card";
import { PRIMARY_ORIGIN, SOLANA_CHART, SOLANA_EXPLORER_TOKEN, SOLANA_MINT, X_URL } from "../lib/site";

const tarballUrl = (origin: string) => `${origin}/downloads/rialto-kit-0.13.0.tgz`;

const JSON_LD = JSON.stringify({
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Rialto",
  sameAs: ["https://x.com/RialtoVenice"],
  applicationCategory: "DeveloperApplication",
  operatingSystem: "Node.js 20+",
  description: "Venice AI agent kit for Solana: wallet-native CLI, MCP server, USDC x402 payments and a budgeted reference agent.",
  url: PRIMARY_ORIGIN,
  license: "https://opensource.org/licenses/MIT",
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
});

export const Route = createFileRoute("/")({
  loader: async () => {
    const [origin, sol] = await Promise.all([getOrigin().catch(() => PRIMARY_ORIGIN), getSol().catch(() => null)]);
    return { origin, sol };
  },
  staleTime: 60_000,
  head: ({ loaderData }) => ({ links: [{ rel: "canonical", href: `${(loaderData as { origin?: string } | undefined)?.origin ?? PRIMARY_ORIGIN}/` }] }),
  component: Index,
});

function ArrowGlyph() {
  return (
    <svg className="r-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

function DownGlyph() {
  return (
    <svg className="r-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 5v14M6 13l6 6 6-6" />
    </svg>
  );
}

function DownloadLink({ href, children }: { href: string; children: string }) {
  return (
    <a href={href} className="r-down inline-flex items-center gap-1.5 text-ink hover:text-brick">
      {children}
      <DownGlyph />
    </a>
  );
}

function XGlyph({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function XLink({ className = "" }: { className?: string }) {
  return (
    <a href={X_URL} rel="noopener" target="_blank" aria-label="Rialto on X" className={`inline-flex items-center justify-center rounded-xl p-2 text-ink-2 transition hover:bg-brick-tint hover:text-brick ${className}`}>
      <XGlyph />
    </a>
  );
}

function Mark() {
  return (
    <svg width="28" height="28" viewBox="0 0 64 64" aria-hidden="true">
      <path d="M10 48c0-14 9.85-24 22-24s22 10 22 24" fill="none" stroke="#B8452F" strokeWidth="7" strokeLinecap="round" />
      <circle cx="32" cy="18" r="6" fill="#2F3A4A" />
    </svg>
  );
}

const TOOLS: { name: string; what: string }[] = [
  { name: "sol_status", what: "SOL, USDC and Rialto balances of any address, current slot." },
  { name: "sol_token", what: "The Rialto mint: supply, authorities, largest holders, price and pool." },
  { name: "sol_holders", what: "Every holder, by a full scan of the mint's token accounts. Concentration." },
  { name: "sol_burns", what: "Burn instructions found in the mint's recent transactions, with signatures." },
  { name: "sol_trades", what: "The trade tape of the deepest pool: buys, sells, USD size, last hour." },
  { name: "sol_stock", what: "Tokenized stocks on Solana (AAPLx, TSLAx, NVDAx): mint, price, pool." },
  { name: "sol_pay", what: "Fetch a URL and pay the 402 in USDC on Solana, under a ceiling and an allowlist." },
  { name: "sol_fund", what: "Top up Venice straight from Solana USDC. No bridge." },
  { name: "sol_send", what: "Send USDC, SOL or Rialto from the agent wallet. Confirmed by you first." },
  { name: "sol_burn", what: "Burn Rialto from the agent wallet. Supply shrinks for good." },
  { name: "venice_chat", what: "Private, uncensored inference paid from the wallet ledger." },
  { name: "venice_web_search", what: "Private web search through Venice." },
  { name: "rialto_agent", what: "The budgeted reference agent, as a tool." },
];

function Index() {
  const { origin, sol } = Route.useLoaderData() as { origin: string; sol: SolData | null };
  const st = sol?.stats ?? null;
  const fmt = (n: number | null | undefined, d = 0) => (n === null || n === undefined || Number.isNaN(n) ? "n/a" : n.toLocaleString("en-US", { maximumFractionDigits: d }));
  const usd = (n: number | null | undefined) => (n === null || n === undefined ? "n/a" : `${n.toLocaleString("en-US", { maximumSignificantDigits: n < 1 ? 4 : 6 })}`);
  const SITE_URL = origin || PRIMARY_ORIGIN;
  const TARBALL = tarballUrl(SITE_URL);
  const INSTALL = `npx ${TARBALL} sol init`;
  return (
    <>
      <StructuredData json={JSON_LD} />
      <header className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <a href="/" className="flex items-center gap-2 font-semibold tracking-tight text-ink">
          <Mark />
          Rialto
        </a>
        <nav className="flex items-center gap-6 text-sm text-ink-2">
          <a href="#demo" className="r-underline hover:text-ink">Demo</a>
          <a href="#how" className="r-underline hidden hover:text-ink sm:inline">How it works</a>
          <Link to="/docs" className="r-underline hover:text-ink">Docs</Link>
          <Link to="/explore" className="r-underline hover:text-ink">Explore</Link>
          <Link to="/live" className="r-underline hover:text-ink">Live</Link>
          <Link to="/playground" className="r-underline hover:text-ink">Playground</Link>
          <a href="#tools" className="r-underline hidden hover:text-ink sm:inline">Tools</a>
          <a href="#token" className="r-underline hover:text-ink">Token</a>
          <a href="#faq" className="r-underline hidden hover:text-ink md:inline">FAQ</a>
          <a href="#downloads" className="r-underline hidden hover:text-ink sm:inline">Downloads</a>
          <a href={SOLANA_MINT ? SOLANA_CHART(SOLANA_MINT) : "#token"} rel="noopener" target={SOLANA_MINT ? "_blank" : undefined} className="r-primary inline-flex items-center gap-1.5 rounded-lg bg-brick px-3 py-1.5 text-sm font-medium text-white transition hover:bg-brick-2">{SOLANA_MINT ? "Buy Rialto" : "Rialto on Solana"}</a>
          <XLink />
          <ThemeToggle />
        </nav>
      </header>
      {st && (
        <Ticker
          initial={[
            ...(sol?.chain ? [{ k: "slot", v: fmt(sol.chain.slot) }] : []),
            ...(st.priceUsd ? [{ k: "Rialto", v: usd(st.priceUsd), tone: "brick" as const }] : []),
            ...(st.change24hPct !== null ? [{ k: "24h", v: `${st.change24hPct > 0 ? "+" : ""}${st.change24hPct}%`, tone: st.change24hPct >= 0 ? ("up" as const) : ("down" as const) }] : []),
            ...(st.volume24hUsd ? [{ k: "24h volume", v: `${fmt(st.volume24hUsd)}` }] : []),
            ...(st.liquidityUsd ? [{ k: "liquidity", v: `${fmt(st.liquidityUsd)}` }] : []),
            ...(sol?.holders?.holders ? [{ k: "holders", v: fmt(sol.holders.holders) }] : []),
            ...(sol?.burns ? [{ k: "burned since launch", v: `${fmt(sol.burns.burnedSinceLaunch ?? sol.burns.burnedTotal)} (${sol.burns.burnedPctOfInitial ?? sol.burns.burnedPctOfCurrentSupply ?? 0}%)`, tone: "brick" as const }] : []),
            ...(sol?.trades ? [{ k: "last hour", v: `${sol.trades.lastHour.buys} buys / ${sol.trades.lastHour.sells} sells`, tone: sol.trades.lastHour.buys >= sol.trades.lastHour.sells ? ("up" as const) : ("down" as const) }] : []),
          ]}
          endpoint="/api/sol/ticker"
        />
      )}

      <main>
        {/* 1. Hero: the animated bridge first, whole and uncovered; the copy sits below it */}
        <section className="border-b border-line">
          <HeroScene />
          <div className="mx-auto max-w-6xl px-6 py-14 md:py-20">
            <div className="max-w-2xl">
              <p className="r-rise font-mono text-xs uppercase tracking-[0.18em] text-brick">Venice AI on Solana</p>
              <h1 className="r-rise r-rise-2 mt-4 text-4xl font-semibold leading-none tracking-tighter text-ink md:text-6xl">Pay in USDC. Think with Venice.</h1>
              <p className="r-rise r-rise-3 mt-5 max-w-[52ch] text-base leading-relaxed text-ink-2">
                A wallet-native agent kit for Solana: a CLI, an MCP server and a budgeted reference agent that fund private Venice inference from the USDC they already hold.
              </p>
              <div className="r-rise r-rise-4 mt-8 flex flex-wrap items-center gap-4">
                <a href="#install" className="r-primary inline-flex items-center gap-2 rounded-xl bg-brick px-5 py-3 text-sm font-medium text-white transition hover:bg-brick-2 active:scale-[0.98]">Install Rialto<ArrowGlyph /></a>
                <Link to="/docs" className="r-underline inline-flex items-center px-1 py-3 text-sm font-medium text-ink">Read the docs</Link>
              </div>
            </div>
            <div className="mt-10 max-w-3xl">
              <CaBar chain="Solana" address={SOLANA_MINT || undefined} explorer={SOLANA_MINT ? SOLANA_EXPLORER_TOKEN(SOLANA_MINT) : undefined} chart={SOLANA_MINT ? SOLANA_CHART(SOLANA_MINT) : undefined} />
            </div>
          </div>
        </section>

        {/* 1b. Demo video */}
        <section id="demo" className="border-b border-line bg-panel">
          <div className="mx-auto max-w-6xl px-6 py-16">
            <h2 className="text-2xl font-semibold tracking-tight text-ink md:text-3xl">See it run in 45 seconds</h2>
            <p className="mt-2 max-w-[60ch] text-ink-2">The real commands and the real outputs: wallet, Venice credit from USDC, x402 payment, budgeted agent.</p>
            <video className="mt-6 w-full rounded-xl border border-line bg-code" src="/assets/rialto-demo-solana-v2.mp4" poster="/assets/og.jpg" controls muted playsInline preload="metadata" />
          </div>
        </section>

        {/* 2. Install strip */}
        <section id="install" className="border-y border-line bg-panel">
          <div className="mx-auto max-w-6xl px-6 py-10">
            <h2 className="text-2xl font-semibold tracking-tight text-ink">One command, one wallet</h2>
            <p className="mt-2 max-w-[60ch] text-ink-2">Node 20 or newer. It creates a Solana keypair in your home folder, prints the address, and tells you exactly what to send to it.</p>
            <div className="mt-5">
              <CopyCommand command={INSTALL} />
            </div>
            <p className="mt-3 font-mono text-xs text-ink-2">
              Then: <span className="text-ink">rialto sol fund 5</span> turns 5 USDC into 5 USD of Venice credit, and <span className="text-ink">rialto chat "..."</span> spends it.
            </p>
          </div>
        </section>

        {/* 3. How it works */}
        <section id="how" className="mx-auto max-w-6xl px-6 py-20">
          <h2 className="text-3xl font-semibold tracking-tight text-ink md:text-4xl">Three spans across the canal</h2>
          <div className="mt-10 grid gap-5 md:grid-cols-3">
            <Span n="1" title="A wallet on Solana">
              <code className="font-mono text-ink">rialto sol init</code> creates the keypair. <code className="font-mono text-ink">rialto sol status</code> shows SOL, USDC and Rialto. Send USDC to it from any exchange or wallet.
            </Span>
            <Span n="2" title="Venice credit, from USDC">
              <code className="font-mono text-ink">rialto sol fund 5</code> tops up your Venice balance straight from Solana USDC through Venice's own x402 top-up. No bridge, no SOL fee, same address billed.
            </Span>
            <Span n="3" title="Think and pay">
              <code className="font-mono text-ink">rialto chat</code> and <code className="font-mono text-ink">rialto agent</code> use that credit for private inference. <code className="font-mono text-ink">rialto sol pay &lt;url&gt;</code> pays any x402 endpoint that takes USDC on Solana, under your ceiling.
            </Span>
          </div>
        </section>

        {/* 4. Tools */}
        <section id="tools" className="border-t border-line">
          <div className="mx-auto max-w-6xl px-6 py-20">
            <h2 className="text-3xl font-semibold tracking-tight text-ink md:text-4xl">Tools your coding agent gets</h2>
            <p className="mt-4 max-w-[62ch] text-ink-2">The local MCP server exposes them to Claude Code, Cursor, Codex or any MCP client. Reads need nothing; writes go through your wallet and your confirmation.</p>
            <ul className="mt-10 grid gap-x-10 md:grid-cols-2">
              {TOOLS.map((t) => (
                <li key={t.name} className="flex items-baseline justify-between gap-4 border-b border-line py-3 text-sm">
                  <code className="font-mono text-ink">{t.name}</code>
                  <span className="text-right text-ink-2">{t.what}</span>
                </li>
              ))}
            </ul>
            <div className="mt-8"><CopyCommand command={`npx -y ${TARBALL} mcp`} /></div>
          </div>
        </section>

        {/* 5. Token */}
        <section id="token" className="border-t border-line bg-panel">
          <div className="mx-auto max-w-6xl px-6 py-20">
            <p className="font-mono text-xs uppercase tracking-wider text-brick">The Rialto token</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-ink md:text-4xl">Rialto moves to Solana.</h2>
            <p className="mt-4 max-w-[62ch] text-ink-2">A new mint on Solana, launched by us. The contract address is published here and on X the moment it goes live, nowhere else first. Anything claiming to be Rialto on Solana before that is not ours.</p>
            <div className="mt-6"><CaBar chain="Solana" address={SOLANA_MINT || undefined} explorer={SOLANA_MINT ? SOLANA_EXPLORER_TOKEN(SOLANA_MINT) : undefined} chart={SOLANA_MINT ? SOLANA_CHART(SOLANA_MINT) : undefined} /></div>
            {st ? (
              <div className="mt-8">
                <Tabs
                  id="token-tabs"
                  tabs={[
                    {
                      key: "now",
                      label: "Now",
                      badge: st.priceUsd ? usd(st.priceUsd) : undefined,
                      content: (
                        <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
                          <div className="rounded-xl border border-line bg-paper p-6">
                            <p className="font-mono text-xs uppercase tracking-wider text-ink-2">Rialto on Solana, right now</p>
                            <dl className="mt-4 grid gap-5 sm:grid-cols-3">
                              <div><dt className="font-mono text-xs text-ink-2">Price</dt><dd className="mt-1 text-lg font-semibold tracking-tight text-ink">{usd(st.priceUsd)}</dd></div>
                              <div><dt className="font-mono text-xs text-ink-2">24h</dt><dd className="mt-1 text-lg font-semibold tracking-tight text-ink">{st.change24hPct === null ? "n/a" : `${st.change24hPct > 0 ? "+" : ""}${st.change24hPct}%`}</dd></div>
                              <div><dt className="font-mono text-xs text-ink-2">FDV</dt><dd className="mt-1 text-lg font-semibold tracking-tight text-ink">{st.fdvUsd ? `$${fmt(st.fdvUsd)}` : "n/a"}</dd></div>
                              <div><dt className="font-mono text-xs text-ink-2">Liquidity</dt><dd className="mt-1 text-lg font-semibold tracking-tight text-ink">{st.liquidityUsd ? `$${fmt(st.liquidityUsd)}` : "n/a"}</dd></div>
                              <div><dt className="font-mono text-xs text-ink-2">24h volume</dt><dd className="mt-1 text-lg font-semibold tracking-tight text-ink">{st.volume24hUsd ? `$${fmt(st.volume24hUsd)}` : "n/a"}</dd></div>
                              <div><dt className="font-mono text-xs text-ink-2">Supply</dt><dd className="mt-1 text-lg font-semibold tracking-tight text-ink">{fmt(st.supply)}</dd></div>
                            </dl>
                            <p className="mt-4 text-xs text-ink-2">{st.pool ? `Deepest pool: ${st.pool.name} on ${st.pool.dex}. ` : ""}{st.pools} pool{st.pools === 1 ? "" : "s"} list the mint. Mint authority {st.mintAuthority ? "set" : "revoked"}, freeze authority {st.freezeAuthority ? "set" : "revoked"}. Same data: /api/sol/token</p>
                          </div>
                          <div className="rounded-xl border border-line bg-paper p-6">
                            <p className="font-mono text-xs uppercase tracking-wider text-ink-2">Last hour</p>
                            {sol?.trades ? (
                              <>
                                <p className="mt-2 text-3xl font-semibold tracking-tight text-ink">{sol.trades.lastHour.buys} <span className="text-base font-medium text-ink-2">buys</span> · {sol.trades.lastHour.sells} <span className="text-base font-medium text-ink-2">sells</span></p>
                                <p className="mt-1 text-sm text-ink-2">${fmt(sol.trades.lastHour.buyUsd)} bought, ${fmt(sol.trades.lastHour.sellUsd)} sold on {sol.trades.label}.</p>
                                <ul className="mt-4 divide-y divide-line">
                                  {sol.trades.trades.slice(0, 8).map((t) => (
                                    <li key={t.tx} className="flex items-baseline justify-between gap-3 py-1.5 text-xs"><span className={t.kind === "buy" ? "font-mono text-emerald-700" : "font-mono text-brick"}>{t.kind.toUpperCase()}</span><span className="font-mono text-ink">${t.usd.toFixed(2)}</span><a className="r-underline font-mono text-ink-2" href={t.explorerUrl} target="_blank" rel="noopener">tx</a></li>
                                  ))}
                                </ul>
                              </>
                            ) : (
                              <p className="mt-2 text-sm text-ink-2">No pool lists the mint yet.</p>
                            )}
                          </div>
                        </div>
                      ),
                    },
                    { key: "rank", label: "Your rank", badge: sol?.board?.holders ? `${fmt(sol.board.holders)} holders` : undefined, content: <SolRankCard board={sol?.board ?? null} /> },
                    {
                      key: "burns",
                      label: "Burns",
                      badge: sol?.burns ? String(sol.burns.count) : undefined,
                      content: (
                        <div className="rounded-xl border border-line bg-paper p-6">
                          <p className="font-mono text-xs uppercase tracking-wider text-ink-2">Burn ledger, from the chain</p>
                          {sol?.burns ? (
                            <>
                              <p className="mt-2 text-3xl font-semibold tracking-tight text-ink">{fmt(sol.burns.burnedSinceLaunch ?? sol.burns.burnedTotal)} <span className="text-base font-medium text-ink-2">burned since launch · {sol.burns.burnedPctOfInitial ?? sol.burns.burnedPctOfCurrentSupply ?? 0}% of the {sol.burns.initialSupply ? fmt(sol.burns.initialSupply) : "current"} created</span></p>
                              <p className="mt-1 text-xs text-ink-2">Derived from supply: 1,000,000,000 created, mint authority null, so supply only moves down. The list below is what the RPC scan found; the total above does not depend on it.</p>
                              <ul className="mt-4 divide-y divide-line">
                                {sol.burns.burns.map((b, i) => (
                                  <li key={b.signature} className="grid grid-cols-[auto_1fr_auto_auto] items-baseline gap-4 py-2.5 text-sm"><span className="font-mono text-xs text-ink-2">#{sol.burns!.burns.length - i}</span><span className="font-mono text-ink">{fmt(b.amount)} Rialto</span><span className="text-xs text-ink-2">{b.time ? b.time.slice(0, 16).replace("T", " ") + " UTC" : `slot ${b.slot}`}</span><a className="r-underline font-mono text-xs text-brick" href={b.explorerUrl} target="_blank" rel="noopener">tx</a></li>
                                ))}
                              </ul>
                              <p className="mt-3 text-xs text-ink-2">BurnChecked instructions found in the last {sol.burns.scannedTransactions} transactions of the mint{sol.burns.complete ? "" : " (scan cut short by the RPC)"}. Same data: /api/sol/burns</p>
                            </>
                          ) : (
                            <p className="mt-2 text-sm text-ink-2">Burn scan unavailable right now.</p>
                          )}
                        </div>
                      ),
                    },
                    {
                      key: "holders",
                      label: "Holders",
                      badge: sol?.holders?.holders ? fmt(sol.holders.holders) : undefined,
                      content: (
                        <div className="rounded-xl border border-line bg-paper p-6">
                          <p className="font-mono text-xs uppercase tracking-wider text-ink-2">Holders, from every token account</p>
                          {sol?.holders ? (
                            <>
                              <p className="mt-2 text-3xl font-semibold tracking-tight text-ink">{sol.holders.holders === null ? "—" : fmt(sol.holders.holders)} <span className="text-base font-medium text-ink-2">wallets · top 10 hold {sol.holders.top10SharePct}%</span></p>
                              <ul className="mt-4 divide-y divide-line">
                                {sol.holders.top.map((h, i) => (
                                  <li key={h.owner} className="grid grid-cols-[auto_auto_1fr_auto] items-baseline gap-4 py-2 text-sm"><span className="font-mono text-xs text-ink-2">{i + 1}</span><a className="r-underline font-mono text-xs text-ink" href={h.explorerUrl} target="_blank" rel="noopener">{h.owner.slice(0, 4)}…{h.owner.slice(-4)}</a><span className="truncate text-xs text-ink-2">{h.label ?? "wallet"}</span><span className="font-mono text-xs text-ink">{h.sharePct}%</span></li>
                                ))}
                              </ul>
                              <p className="mt-3 text-xs text-ink-2">{sol.holders.tokenAccounts} token accounts scanned, slot {fmt(sol.holders.asOfSlot)}.{sol.holders.note ? ` ${sol.holders.note}` : ""} Same data: /api/sol/holders</p>
                            </>
                          ) : (
                            <p className="mt-2 text-sm text-ink-2">Holder scan unavailable right now.</p>
                          )}
                        </div>
                      ),
                    },
                  ]}
                />
              </div>
            ) : (
            <div className="mt-8 grid gap-6 md:grid-cols-3">
              <div className="rounded-xl border border-line bg-paper p-6">
                <p className="font-mono text-xs uppercase tracking-wider text-ink-2">At launch</p>
                <p className="mt-2 text-sm text-ink-2">The kit reads the mint from the chain on day one: supply, every holder by a full scan, burns, the trade tape. <code className="font-mono text-ink">rialto sol token</code>, <code className="font-mono text-ink">holders</code>, <code className="font-mono text-ink">burns</code>, <code className="font-mono text-ink">trades</code>.</p>
              </div>
              <div className="rounded-xl border border-line bg-paper p-6">
                <p className="font-mono text-xs uppercase tracking-wider text-ink-2">Burns</p>
                <p className="mt-2 text-sm text-ink-2">Burning is a BurnChecked instruction on the mint: the supply shrinks on chain, for good. <code className="font-mono text-ink">rialto sol burn &lt;amount&gt; --yes</code>. Every burn is listed with its signature.</p>
              </div>
              <div className="rounded-xl border border-line bg-paper p-6">
                <p className="font-mono text-xs uppercase tracking-wider text-ink-2">Ledger on the site</p>
                <p className="mt-2 text-sm text-ink-2">Holders, burns, your rank and your badge come back here, read from Solana, once the mint is live. Nothing typed by hand, every figure current to the slot shown.</p>
              </div>
            </div>
            )}
            <p className="mt-6 text-sm text-ink-2">Set the mint in the kit when it drops: <code className="font-mono text-ink">rialto sol config mint &lt;address&gt;</code>.</p>
          </div>
        </section>

        {/* 6. FAQ */}
        <section id="faq" className="mx-auto max-w-6xl px-6 py-20">
          <h2 className="text-3xl font-semibold tracking-tight text-ink md:text-4xl">Questions</h2>
          <div className="mt-10 grid gap-10 md:grid-cols-2">
            <Faq q="Is Rialto an official Venice AI product?">No. Rialto is an independent kit built on Venice's public x402 API. Venice bills the wallet that signs; Rialto holds no key and no credit.</Faq>
            <Faq q="Why Solana?">Fees under a cent, finality in seconds, and Venice accepts USDC on Solana for top-ups directly. The payer needs no SOL: the facilitator pays the transaction fee.</Faq>
            <Faq q="What does a payment look like?">An x402 endpoint answers 402 with the price in USDC. The kit builds a transfer to the recipient, signs it, and the server's facilitator lands it. One request, one receipt, no account.</Faq>
            <Faq q="What are the guardrails?">A per-payment ceiling (maxPaymentUsdg, in dollars), an optional allowlist of hosts the payer may pay, a hard budget per agent run, and a confirmation line on every irreversible command.</Faq>
            <Faq q="Where is the token?">On Solana, with a new mint we publish here and on X the moment it goes live. Only trust the address printed on this page.</Faq>
            <Faq q="Can an agent use it without a human?">Yes, within the limits you set. The MCP tools expose balances, the token, payments and Venice inference; sends and burns are marked irreversible so the agent asks first.</Faq>
          </div>
        </section>

        {/* 7. Changelog */}
        <section id="changelog" className="border-t border-line bg-panel">
          <div className="mx-auto max-w-6xl px-6 py-20">
            <h2 className="text-3xl font-semibold tracking-tight text-ink md:text-4xl">What changed</h2>
            <ul className="mt-10 divide-y divide-line border-y border-line">
              <Change date="Nov 12, 2026" what="Kit 0.13.0: a daily limit. rialto config dailyLimitUsd 2 caps the x402 payments the wallet signs per UTC day, across every run, the CLI and the MCP server. The payer checks the receipts ledger before signing and refuses what would cross the limit. Per-run caps stop one run; this stops a hundred. rialto sol receipts shows signed today and what is left." />
              <Change date="Nov 8, 2026" what="Burn since launch is now derived from supply, not from a transaction scan: 1,000,000,000 created, mint authority null, so created minus current is the burn, on the ticker, the home page, /api/sol/burns and in kit 0.12.1 (rialto sol token, rialto sol burns). The public RPC can throttle a scan; it cannot throttle a subtraction. Source now linked: github.com/RialtoVenice/rialto." />
              <Change date="Nov 6, 2026" what="Kit 0.12.0: a local ledger of every payment the kit signs. ~/.rialto/receipts.jsonl gets one line per x402 payment or Venice top-up (time, URL, amount, status, signature, ceiling), written by the payer itself. rialto sol receipts sums it up; the agent and the MCP read it through sol_receipts." />
              <Change date="Nov 4, 2026" what="Kit 0.11.0: per-tool caps for the agent. rialto agent --cap sol_pay=0.05 --cap venice=0.03 gives each tool its own ceiling for the run: a paying tool is refused once its cap is spent and the remaining cap becomes the ceiling of its next payment, venice stops inference at its cap. The run budget now counts payments too. Also in config as toolCaps, and in the MCP rialto_agent tool. The reference agent now runs on the Solana tools (sol_status, sol_token, sol_holders, sol_stock, sol_pay). Mint live: 8h88ucUAF5o6CEr8rphy9rwNPD7gt2qBEmCv81SCpump." />
              <Change date="Nov 3, 2026" what="Rialto moves to Solana. Kit 0.10.0: rialto sol init, status, config, token, holders, burns, trades, stock, send, burn, fund and pay, plus watch. Venice top-ups straight from Solana USDC through Venice's own x402 top-up; x402 payments in USDC with the exact scheme, facilitator-paid fees. Classic Token and Token-2022 mints both work. Local MCP adds the sol_* tools. The new site, this page, is written for Solana; the token section fills in the day the mint goes live." />
            </ul>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer id="downloads" className="border-t border-line bg-panel">
        <div className="mx-auto grid max-w-6xl gap-10 px-6 py-14 md:grid-cols-3">
          <div>
            <p className="flex items-center gap-2 font-semibold text-ink">
              <Mark />
              Rialto
            </p>
            <p className="mt-3 max-w-[36ch] text-sm text-ink-2">Not audited. Keep small balances in the agent wallet. The private key never leaves your machine.</p>
            <p className="mt-3 max-w-[36ch] text-sm text-ink-2">Independent project. Not affiliated with Venice AI or the Solana Foundation. Rialto uses their public APIs like any developer.</p>
            <div className="mt-4 flex items-center gap-2">
              <XLink className="-ml-2" />
              <span className="text-sm text-ink-2">Follow Rialto on X</span>
            </div>
          </div>
          <div className="space-y-2 text-sm">
            <p className="font-mono text-xs uppercase tracking-wider text-ink-2">Downloads</p>
            <p><DownloadLink href="/downloads/rialto-kit-0.13.0.tgz">rialto-kit-0.13.0.tgz</DownloadLink></p>
            <p><DownloadLink href="/downloads/rialto-kit-source.zip">Source, zip</DownloadLink></p>
            <p><DownloadLink href="/downloads/SKILL.md">SKILL.md for agents</DownloadLink></p>
          </div>
          <div className="space-y-2 text-sm">
            <p className="font-mono text-xs uppercase tracking-wider text-ink-2">Around the bridge</p>
            <p><a className="r-underline text-ink" href="https://docs.venice.ai/guides/integrations/x402-venice-api" rel="noopener">Venice x402 guide</a></p>
            <p><a className="r-underline text-ink" href="https://builtinvenice.ai/" rel="noopener">Built in Venice</a></p>
            <p><a className="r-underline text-ink" href="https://solscan.io/" rel="noopener">Solana explorer</a></p>
            <p><Link className="r-underline text-ink" to="/status">Status</Link> · <a className="r-underline text-ink" href="https://www.x402.org/" rel="noopener">x402 protocol</a> · <a className="r-underline text-ink" href="/llms.txt">llms.txt</a></p>
          </div>
        </div>
      </footer>
    </>
  );
}

function Span({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <div className="relative rounded-xl border border-line bg-panel p-6">
      <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-brick-tint font-mono text-sm text-brick">{n}</span>
      <h3 className="mt-4 text-lg font-semibold tracking-tight text-ink">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-ink-2">{children}</p>
    </div>
  );
}

function Faq({ q, children }: { q: string; children: string }) {
  return (
    <div>
      <h3 className="text-lg font-semibold tracking-tight text-ink">{q}</h3>
      <p className="mt-2 text-sm leading-relaxed text-ink-2">{children}</p>
    </div>
  );
}

function Change({ date, what }: { date: string; what: string }) {
  return (
    <li className="grid gap-1 py-4 md:grid-cols-[160px_1fr] md:gap-6">
      <span className="font-mono text-xs text-ink-2">{date}</span>
      <span className="text-ink">{what}</span>
    </li>
  );
}
