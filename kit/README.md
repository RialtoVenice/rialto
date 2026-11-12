# Rialto kit

**Venice AI agent kit on Solana.** One wallet, on Solana, that pays for everything the agent uses: USDC payments to x402 endpoints, and private Venice AI inference funded from that same USDC. No API key, no custodian, every spend capped in code before anything is signed.

The name is the bridge. In Venice, the Rialto crosses the Grand Canal. Here it crosses from a Solana wallet to Venice AI inference credit, inside the agent's own keypair.

## Install

The package is not on npm yet. Install the hosted tarball, or build from this folder.

```bash
npm i -g https://rialto.casa/downloads/rialto-kit-0.13.0.tgz
rialto sol init                  # creates the Solana keypair in ~/.rialto/config.json (mode 600)
```

From source:

```bash
npm install
npm run build
npm link                         # or: node bin/rialto.js <command>
```

Send a few USDC and a little SOL to the printed address, then:

```bash
rialto sol status                # SOL, USDC and Rialto balances, current slot
rialto sol fund 5                # Venice top-up straight from Solana USDC (Venice minimum: 5)
rialto chat "What does the Rialto mint look like right now?"
rialto agent "Compare AAPLx, TSLAx and NVDAx on Solana and tell me which pool is deepest" -b 0.25 --cap sol_pay=0.05 --cap venice=0.10
rialto sol pay https://rialto.casa/x402/pulse --dry-run
rialto mcp                       # MCP server on stdio for Claude, Cursor, Hermes, OpenClaw
```

## Solana commands

| Command | What it does |
|---|---|
| `rialto sol init` | Create or show the Solana keypair. The secret never leaves the config file. |
| `rialto sol status [address]` | SOL, USDC and Rialto balances, current slot. |
| `rialto sol config mint <address>` | Set the Rialto mint used by default. |
| `rialto sol token [mint]` | Mint facts: supply, decimals, mint and freeze authorities, burn since launch (1B created minus supply), 20 largest accounts with owners, price and pool. |
| `rialto sol holders [mint] -n 20` | Holders: full scan when the RPC allows `getProgramAccounts`, else the 20 largest with `complete: false`. |
| `rialto sol burns [mint]` | Burn instructions in the mint's recent transactions, with amounts and signatures. |
| `rialto sol trades [mint]` | Trade tape of the deepest pool: buys, sells, USD size, last hour totals. |
| `rialto sol stock <symbol>` | Tokenized stock on Solana (xStocks: AAPLx, TSLAx, NVDAx): mint, USD price, deepest pool. |
| `rialto sol fund <usd>` | Top up Venice from this wallet's USDC through Venice's Solana x402 lane. No bridge, no SOL fee. |
| `rialto sol pay <url> [--dry-run] [--max <usd>]` | Fetch a URL and pay in USDC if it answers 402 with a Solana option (x402 exact scheme). |
| `rialto sol receipts [-n 20] [--since <date>] [--json]` | Every payment this kit signed: totals, by host, the last N, from the local ledger `~/.rialto/receipts.jsonl`. |
| `rialto sol send <to> <amount> --yes [--sol \| --rialto]` | Send USDC, SOL or Rialto. Irreversible. |
| `rialto sol burn <amount> --yes` | Burn Rialto (BurnChecked). Irreversible. |
| `rialto sol watch [--json]` | Follow slot, balances and the Rialto trade tape live. |

Venice and the agent:

| Command | What it does |
|---|---|
| `rialto chat "<prompt>" [--web] [-m model]` | Ask a Venice model, paid from the wallet's Venice credit. |
| `rialto agent "<goal>" -b <usd> [--cap tool=usd ...]` | Budgeted reference agent with Solana tools and x402 payments. |
| `rialto venice balance` / `ledger` / `models` / `search "<q>"` | Venice account and private web search. |
| `rialto mcp` | MCP server on stdio. |
| `rialto skill` | Print SKILL.md for coding agents. |
| `rialto config [key] [value]` | Read or write the config file. |

The CLI also keeps the commands of the kit's first chain, an EVM network (chain id 4663), under their original names (`status`, `pay`, `fund`, `bridge`, `token`, `holders`, `watch`, ...). `rialto --help` lists them. The Solana side is where the project lives now.

## Money guards

All enforced locally, before any signature:

| Guard | Scope | Where |
|---|---|---|
| `agentBudgetUsd` (`-b`) | One `rialto agent` run: inference plus every payment, measured from Venice's `X-Balance-Remaining` header | `agent.ts` |
| `toolCaps` (`--cap tool=usd`) | One tool inside a run. `sol_pay` is refused once its cap is spent and the remaining cap becomes the ceiling of the next payment. `venice` stops inference at its cap. | `agent.ts` |
| `maxPaymentUsdg` (`--max`) | One x402 payment | `solpay.ts` |
| `dailyLimitUsd` | Every x402 payment signed in one UTC day, across runs, the CLI and the MCP server. Checked against the receipts ledger; a payment that would cross it is refused before signing. Failed payments count: a signature is a commitment. | `solpay.ts`, `receipts.ts` |
| `payAllowlist` | Hosts the payer may pay | `solpay.ts` |

When a tool is refused, the model receives the refusal as a normal tool result. The system prompt tells it not to retry and to finish with what it has.

Every payment the kit signs (x402 on Solana, Venice top-ups) is appended to `~/.rialto/receipts.jsonl` (mode 600) by the payer itself, so the CLI, the MCP server and the agent leave the same trail: time, URL, amount, HTTP status, transaction signature when the facilitator reports one, and the ceiling that applied. `rialto sol receipts` sums it up; the agent and the MCP read it through `sol_receipts`. Nothing is uploaded anywhere.

## Configuration

`~/.rialto/config.json` (mode 600), or environment variables. `RIALTO_HOME` moves the folder.

| Key | Env | Default | Meaning |
|---|---|---|---|
| `solanaSecret` | `SOLANA_SECRET_KEY` | generated by `sol init` | The Solana keypair |
| `solanaMint` | `RIALTO_SOLANA_MINT` | the Rialto mint | Mint used by default |
| | `SOLANA_RPC_URL` | public RPC | Private RPC for full holder scans and burn history |
| `veniceApiKey` | `VENICE_API_KEY` | unset | Use an API key instead of the wallet ledger |
| `defaultModel` | `RIALTO_MODEL` | `zai-org-glm-5-2` | Venice model |
| `agentBudgetUsd` | `RIALTO_AGENT_BUDGET_USD` | `1` | Hard cap per agent run |
| `toolCaps` | | unset | Per-tool caps, e.g. `sol_pay=0.05,venice=0.03` |
| `maxPaymentUsdg` | `RIALTO_MAX_PAYMENT_USDG` | `1` | Hard cap per x402 payment |
| `dailyLimitUsd` | `RIALTO_DAILY_LIMIT_USD` | unset | Cap on x402 payments signed per UTC day; `rialto config dailyLimitUsd off` removes it |
| `payAllowlist` | | empty | Hostnames the payer may pay |

## MCP

Local, full tools, has the wallet:

```json
{ "mcpServers": { "rialto": { "command": "rialto", "args": ["mcp"] } } }
```

Hosted, read-only, no install: `https://rialto.casa/mcp` (Streamable HTTP, stateless).

## What is inside

| Module | Role |
|---|---|
| `solana.ts` | Keypair, balances, mint facts, holders, burns, trades, xStocks, transfers |
| `solpay.ts` | x402 payer for Solana (`exact` scheme, USDC), ceiling and allowlist, Venice top-up |
| `receipts.ts` | Local ledger of every payment signed, and its summary |
| `venice.ts` | `SIGN-IN-WITH-X` auth, chat with tools, balance, ledger, models, web search |
| `agent.ts` | Budgeted reference agent: Venice function calling, per-tool caps, Solana tools |
| `mcp.ts` | MCP server (stdio) exposing everything |
| `cli.ts` | The `rialto` command |
| `config.ts` | Config file and environment |
| `hood.ts`, `x402.ts`, `bridge.ts`, `stocks.ts`, `feeds.ts`, `access.ts`, `wallet.ts`, `chains.ts` | The EVM side (first chain of the kit) |

## Security notes

- Keys are generated locally and stored with mode 600. Nothing is uploaded anywhere.
- Ceilings, caps and the allowlist are enforced in code before any signature is produced.
- Not audited. Keep small balances in the agent wallet.

## Development

```bash
npm install
npm run build
RIALTO_HOME=/tmp/rialto-dev node bin/rialto.js sol init
```

MIT. Site: https://rialto.casa. Updates: https://x.com/RialtoVenice.
