import { createFileRoute, Link } from "@tanstack/react-router";
import { CopyCommand } from "../components/copy-command";
import { GITHUB_URL, PRIMARY_ORIGIN, X_URL } from "../lib/site";

export const Route = createFileRoute("/docs")({
  head: () => ({
    meta: [
      { title: "Rialto docs" },
      { name: "description", content: "Install, fund and run Rialto on Solana: commands, configuration, MCP setup, guardrails." },
    ],
    links: [{ rel: "canonical", href: `${PRIMARY_ORIGIN}/docs` }],
  }),
  component: Docs,
});

const TARBALL = `${PRIMARY_ORIGIN}/downloads/rialto-kit-0.14.0.tgz`;

const COMMANDS: [string, string][] = [
  ["rialto sol init", "Create the Solana keypair (or show it). The secret stays in ~/.rialto/config.json, mode 600."],
  ["rialto sol status [address]", "SOL, USDC and Rialto balances of an address (default: this wallet), current slot."],
  ["rialto sol address", "Print this wallet's public key, to fund it."],
  ["rialto sol fund <usd>", "Top up Venice straight from this wallet's USDC on Solana. Minimum 5. No bridge, no SOL fee."],
  ["rialto sol pay <url> [-X POST] [-d body] [--max usdc] [--dry-run]", "Fetch a URL and pay in USDC on Solana if it answers 402 with a Solana option. --dry-run shows the price without paying."],
  ["rialto sol config mint <address>", "Set the Rialto mint once the token is live. RIALTO_SOLANA_MINT overrides it."],
  ["rialto sol token [mint]", "Supply, decimals, authorities, the largest holders with owners, price and pool."],
  ["rialto sol holders [mint] [-n 20]", "Every holder by a full scan of the mint's token accounts, top holders, concentration."],
  ["rialto sol burns [mint] [-s 100]", "Burn instructions in the mint's recent transactions: amount, authority, time, signature, total."],
  ["rialto sol trades [mint] [-l 20]", "Recent trades on the deepest pool: buys and sells, USD size, price, last hour totals."],
  ["rialto sol stock <symbol>", "Tokenized stocks on Solana (AAPLx, TSLAx, NVDAx…): mint, USD price, deepest pool."],
  ["rialto sol send <to> <amount> --yes [--sol | --rialto]", "Send USDC (default), SOL or Rialto from this wallet. Irreversible."],
  ["rialto sol burn <amount> --yes", "Burn Rialto from this wallet. The supply shrinks for good. Irreversible."],
  ["rialto sol watch [-e 15] [--json] [--once]", "Follow Solana live: slot, this wallet's balances, the Rialto trade tape."],
  ["rialto chat \"<prompt>\" [--model m] [--web]", "One Venice completion from the wallet's credit. --web adds private web search."],
  ["rialto venice balance", "Venice credit of the wallet that signs in. Since kit 0.14.0 that is the Solana keypair: every Venice call carries a SIGN-IN-WITH-X header signed with its ed25519 key, so the wallet that pays the top-up is the wallet that spends it. rialto config veniceWallet evm switches back to the EVM key."],
  ["rialto config dailyLimitUsd 2", "Daily limit: the most USDC of x402 payments this wallet may sign per UTC day, across every run, the CLI and the MCP server. Checked against the receipts ledger before signing. off removes it."],
  ["rialto sol receipts [-n 20] [--since <date>] [--json]", "Every payment this kit signed, x402 on Solana and Venice top-ups: totals, by host, the last N, with transaction signatures. Read from ~/.rialto/receipts.jsonl, costs nothing."],
  ["rialto agent \"<goal>\" [-b 0.25] [--cap sol_pay=0.05]", "The budgeted reference agent: plans, calls tools, stops at the budget. --cap tool=usd caps one tool for the run; repeat it per tool."],
  ["rialto venice balance | ledger | models | search \"<q>\"", "Venice account, history, models, private web search."],
  ["rialto mcp", "Start the MCP server on stdio for Claude Code, Cursor, Codex or any MCP client."],
  ["rialto skill", "Print the SKILL.md for coding agents."],
  ["rialto config [key] [value]", "Read or set defaultModel, agentBudgetUsd, maxPaymentUsdg (the per-payment ceiling, in dollars), payAllowlist, toolCaps (sol_pay=0.05,venice=0.03)."],
];

function H2({ id, children }: { id: string; children: string }) {
  return (
    <h2 id={id} className="mt-16 scroll-mt-24 text-2xl font-semibold tracking-tight text-ink">
      {children}
    </h2>
  );
}

function Docs() {
  return (
    <>
      <header className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Link to="/" className="font-semibold tracking-tight text-ink">Rialto</Link>
        <nav className="flex items-center gap-6 text-sm text-ink-2">
          <a href="#install" className="r-underline hover:text-ink">Install</a>
          <a href="#fund" className="r-underline hover:text-ink">Fund</a>
          <a href="#commands" className="r-underline hover:text-ink">Commands</a>
          <a href="#mcp" className="r-underline hover:text-ink">MCP</a>
          <a href="#guardrails" className="r-underline hover:text-ink">Guardrails</a>
          <a href={GITHUB_URL} rel="noopener" target="_blank" className="r-underline hover:text-ink">GitHub</a>
          <a href={X_URL} rel="noopener" target="_blank" className="r-underline hover:text-ink">X</a>
        </nav>
      </header>
      <main className="mx-auto max-w-3xl px-6 pb-24 pt-10">
        <p className="font-mono text-xs uppercase tracking-wider text-brick">Docs · Solana</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight text-ink">Rialto on Solana</h1>
        <p className="mt-4 text-lg text-ink-2">One wallet on Solana. It pays x402 endpoints in USDC and funds private Venice AI inference from the same address. Everything below runs on your machine; the private key never leaves it.</p>

        <H2 id="install">Install</H2>
        <p className="mt-3 text-ink-2">Node 20 or newer. The first command creates the Solana keypair and prints the address to fund.</p>
        <div className="mt-3 space-y-2">
          <CopyCommand command={`npx ${TARBALL} sol init`} />
          <CopyCommand command={`npm i -g ${TARBALL}`} />
        </div>
        <p className="mt-3 text-sm text-ink-2">Send USDC to the printed address from any wallet or exchange. Payments need no SOL: the facilitator pays the transaction fee. Keep a little SOL only if you want to send or burn tokens yourself.</p>

        <H2 id="fund">Fund Venice</H2>
        <p className="mt-3 text-ink-2">Venice accepts USDC on Solana for top-ups through its own x402 endpoint. The kit builds the transfer, signs it, and Venice's facilitator lands it. The credit goes to the Venice ledger of the same address.</p>
        <div className="mt-3 space-y-2">
          <CopyCommand command="rialto sol fund 5" />
          <CopyCommand command="rialto venice balance" />
          <CopyCommand command={'rialto chat "Explain x402 in two sentences"'} />
        </div>
        <p className="mt-3 text-sm text-ink-2">Minimum top-up 5 USD. The wallet must hold the USDC already; the kit never bridges or swaps on your behalf.</p>

        <H2 id="pay">Pay any x402 endpoint</H2>
        <p className="mt-3 text-ink-2">An endpoint that answers 402 with a USDC-on-Solana option gets paid in one request. The ceiling and the allowlist apply before anything is signed.</p>
        <div className="mt-3 space-y-2">
          <CopyCommand command="rialto sol pay https://api.venice.ai/api/v1/x402/top-up -X POST --dry-run" />
          <CopyCommand command="rialto sol pay https://example.com/x402/report --max 0.05" />
        </div>

        <H2 id="commands">Commands</H2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <tbody className="divide-y divide-line">
              {COMMANDS.map(([c, d]) => (
                <tr key={c}>
                  <td className="py-3 pr-4 align-top font-mono text-ink">{c}</td>
                  <td className="py-3 align-top text-ink-2">{d}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <H2 id="token">The token</H2>
        <p className="mt-3 text-ink-2">Once the Rialto mint is live on Solana, set it in the kit and every ledger command reads it from the chain: supply and authorities, every holder by a full token-account scan, burn instructions with their signatures, the trade tape. Classic Token and Token-2022 mints both work.</p>
        <div className="mt-3 space-y-2">
          <CopyCommand command="rialto sol config mint <address>" />
          <CopyCommand command="rialto sol holders -n 25" />
          <CopyCommand command="rialto sol burns -s 200" />
        </div>
        <p className="mt-3 text-sm text-ink-2">The public Solana endpoint throttles transaction reads, so burn scans may need a private RPC: set <code className="font-mono text-ink">SOLANA_RPC_URL</code> to a free Helius, QuickNode or Triton endpoint.</p>

        <H2 id="mcp">MCP for coding agents</H2>
        <p className="mt-3 text-ink-2">The local MCP server exposes the Solana tools and Venice inference to Claude Code, Cursor, Codex or any MCP client. Reads are free; sends, burns and payments are marked irreversible so the agent asks first.</p>
        <div className="mt-3"><CopyCommand command={`{"mcpServers":{"rialto":{"command":"npx","args":["-y","${TARBALL}","mcp"]}}}`} /></div>
        <p className="mt-3 text-sm text-ink-2">Tools: sol_status, sol_token, sol_holders, sol_burns, sol_trades, sol_stock, sol_pay, sol_fund, sol_send, sol_burn, venice_chat, venice_web_search, rialto_agent. <code className="font-mono text-ink">rialto skill</code> prints the SKILL.md.</p>

        <H2 id="guardrails">Guardrails</H2>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-ink-2">
          <li><code className="font-mono text-ink">maxPaymentUsdg</code>: the per-payment ceiling, in dollars (default 1). Applies to USDC on Solana too.</li>
          <li><code className="font-mono text-ink">payAllowlist</code>: hosts the payer may pay. Empty means any HTTPS host.</li>
          <li><code className="font-mono text-ink">agentBudgetUsd</code>: hard budget for one agent run, inference plus payments (default 1).</li>
          <li><code className="font-mono text-ink">toolCaps</code>: one cap per tool inside a run. sol_pay is refused once its cap is spent; venice stops inference at its cap. A cap never loosens the per-payment ceiling: the payer applies the tighter of the two, the ceiling or what is left on the cap. Set per run with <code className="font-mono text-ink">--cap sol_pay=0.05 --cap venice=0.03</code>, or once with <code className="font-mono text-ink">rialto config toolCaps sol_pay=0.05,venice=0.03</code>.</li>
          <li><code className="font-mono text-ink">receipts.jsonl</code>: every payment the kit signs is appended to a local ledger by the payer itself, with time, URL, amount, status, signature and the ceiling that applied. <code className="font-mono text-ink">rialto sol receipts</code>, MCP and agent tool <code className="font-mono text-ink">sol_receipts</code> read it.</li>
          <li><code className="font-mono text-ink">dailyLimitUsd</code>: a cap on the x402 payments signed in one UTC day. The payer sums today\'s lines in the receipts ledger and refuses a payment that would cross the limit, before signing. Per-run caps stop one run; this one holds across a hundred runs, the CLI and the MCP server. Failed payments count too: a signature is a commitment.</li>
          <li>Every irreversible command (send, burn) refuses to run without <code className="font-mono text-ink">--yes</code>.</li>
          <li>Environment: <code className="font-mono text-ink">SOLANA_RPC_URL</code>, <code className="font-mono text-ink">RIALTO_SOLANA_MINT</code>, <code className="font-mono text-ink">SOLANA_SECRET_KEY</code> (base58), <code className="font-mono text-ink">VENICE_API_KEY</code> for key mode.</li>
        </ul>
        <p className="mt-10 text-sm text-ink-2">Not audited. Keep small balances in the agent wallet. Independent project, not affiliated with Venice AI or the Solana Foundation.</p>
      </main>
    </>
  );
}
