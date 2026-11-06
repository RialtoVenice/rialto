---
name: rialto
description: Venice AI agent kit for Robinhood Chain. Use when an agent needs to hold USDG on Robinhood Chain, pay x402 endpoints in USDG, read tokenized stock prices or wallets on Robinhood Chain, or fund and call Venice AI from the same wallet without an API key.
---

# Rialto

Rialto gives an agent one EVM wallet that lives on Robinhood Chain (chain id 4663) and pays for everything it uses:

- **USDG payments** to any x402 endpoint on Robinhood Chain (v1 or v2, `exact` scheme, EIP-3009 on USDG, no gas).
- **Venice AI inference** paid from that same wallet: `rialto fund <usdg>` bridges USDG to USDC on Base and tops up the wallet's Venice credit. Every Venice call then carries a signed `SIGN-IN-WITH-X` header.
- **Robinhood Chain reads**: chain status, ETH and USDG balances, wallet reports, tokenized stock prices (AAPL, TSLA, NVDA and any ticker), top pools.

## Install

```bash
npx rialto-kit init          # creates ~/.rialto/config.json with a fresh wallet
```

Or from the hosted tarball when the package is not on npm yet:

```bash
npx https://rialto.casa/downloads/rialto-kit-0.1.0.tgz init
```

Then fund the printed address on Robinhood Chain: USDG for spending plus a few cents of ETH for gas.

## Commands

| Command | What it does |
|---|---|
| `rialto init [--venice-key <key>]` | Create or show the wallet. Optional API-key mode for Venice. |
| `rialto status` | Balances on Robinhood Chain, Venice credit, chain status. |
| `rialto fund <usdg>` | USDG -> USDC on Base (Relay, Across fallback) -> Venice top-up. Raises the amount itself so at least 5 USD land at Venice after bridge fees. |
| `rialto chat "<prompt>" [--web] [-m model]` | Ask Venice. |
| `rialto agent "<goal>" -b <usd> [--cap tool=usd]` | Budgeted reference agent with Solana tools and USDC x402 payments. `--cap sol_pay=0.05 --cap venice=0.03` caps each tool separately for the run. |
| `rialto pay <url> [--dry-run] [--max <usdg>]` | Fetch a URL, pay in USDG if it answers 402. |
| `rialto stocks price <ticker>` / `find` / `pools` / `list` | Tokenized stocks and pools on Robinhood Chain. |
| `rialto wallet <address>` | Read-only wallet report. |
| `rialto send <to> <usdg>` | Transfer USDG. Irreversible. |
| `rialto quote <usdg>` / `rialto bridge <usdg>` / `rialto topup <usd>` | Bridge pieces, individually. |
| `rialto venice balance` / `ledger` / `models` / `search "<q>"` | Venice account and web search. |
| `rialto mcp` | Start the MCP server on stdio. |
| `rialto config [key] [value]` | `defaultModel`, `agentBudgetUsd`, `maxPaymentUsdg`, `payAllowlist`, `toolCaps` (`sol_pay=0.05,venice=0.03`), `veniceApiKey`. |

## MCP

Local (full tools, has the wallet):

```json
{ "mcpServers": { "rialto": { "command": "npx", "args": ["-y", "rialto-kit", "mcp"] } } }
```

Hosted, read-only, no install: `https://rialto.casa/mcp` (mirror: `https://rialto-kit.higgsfield.app/mcp`) (Streamable HTTP, stateless).

Tools: `rialto_wallet`, `hood_chain_status`, `hood_balances`, `hood_wallet_report`, `hood_stock_price`, `hood_stock_find`, `hood_top_pools`, `hood_send_usdg`, `x402_pay`, `venice_chat`, `venice_web_search`, `venice_models`, `venice_balance`, `venice_transactions`, `rialto_quote_bridge`, `rialto_fund_venice`, `rialto_agent`.

## Guardrails an agent must respect

- `maxPaymentUsdg` (default 1) caps one x402 payment. `payAllowlist` restricts hosts.
- `agentBudgetUsd` (default 1) caps one `rialto agent` run, measured from Venice's `X-Balance-Remaining` plus every x402 payment the run made.
- `toolCaps` caps each tool separately inside a run: `sol_pay` is refused once its cap is spent and the remaining cap becomes the ceiling of the next payment, `venice` stops inference at its cap. Set per run with `--cap tool=usd` or once in config.
- `hood_send_usdg` and `rialto_fund_venice` move real funds. Confirm with the user before calling them.
- The private key never leaves `~/.rialto/config.json` (mode 600) or `RIALTO_PRIVATE_KEY`.
- Every payment signed is appended to `~/.rialto/receipts.jsonl`. `rialto sol receipts` / MCP `sol_receipts` / agent tool `sol_receipts` read it. Check it before and after a run that pays.

## Facts the code relies on (verified 2026-09-09)

- USDG on Robinhood Chain: `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`, 6 decimals, EIP-712 domain `Global Dollar` v`1`, supports `transferWithAuthorization` (EIP-3009) and `permit`.
- Venice x402: prepaid USD ledger per wallet, top-up with USDC on Base (`eip155:8453`) or Solana, minimum 5 USD. Auth header `SIGN-IN-WITH-X`.
- Relay and Across both bridge USDG (4663) to USDC (8453) in about 2 seconds for roughly 0.1 percent.


## Holder tiers (hosted API and MCP)

The hosted endpoints at https://rialto.casa apply a tier from the Rialto token balance of the wallet that signs in. Free: 30 requests per minute per IP. Holder (300,000 Rialto): 120 per minute and `hood_portfolio` / `GET /api/portfolio/{address}`. Pro (1,000,000 Rialto): 600 per minute and `hood_batch` / `POST /api/batch`.

```
rialto access            # tier and Rialto balance of this wallet
rialto access 0x...      # tier of any address
rialto access sign       # 24 hour token; paste mcpUrl into an MCP client or send x-rialto-auth
```

MCP tools: `rialto_access`, `rialto_access_sign`. Signing costs nothing and moves nothing.

## Live feeds

```
rialto transfers -n 150     # USDG transfers in the last 150 blocks, from the chain logs
rialto trades NVDA          # recent trades on the NVDA / USDG pool; RIALTO by default
rialto check 0x…            # token check: identity, supply, age, holders, concentration, liquidity, flags
rialto token                # Rialto price, FDV, liquidity, 24h volume, volume since launch across every pool
rialto burns                # every burn of the Rialto token, running total, percent of supply
rialto holders -n 10        # holder count, top holders, concentration, and the block the figures are current to
rialto watch                # follow the chain live: blocks, USDG flow, Rialto trades, burns, this wallet's balances and rank
rialto watch -w 0x… --json  # watch another wallet; one JSON object per event, for scripts and agents
rialto watch --only burn,rank --webhook <url> [--discord]  # filter event types, POST each one to a webhook
rialto watch --only trade --min-usd 500 --format slack --webhook <url>  # whale trades only; formats: raw, discord, slack
rialto compare <a> <b>      # two wallets side by side on the ledger
rialto export burns --csv   # holders | leaderboard | burns | history as JSON (default) or CSV, -o file
rialto sol init | status | config mint <addr> | token | holders | burns | trades | send <to> <amount> --yes   # Rialto on Solana
rialto sol fund 5 | pay <url> | burn <amount> --yes | stock AAPLx | watch   # Venice top-up from Solana USDC, x402 in USDC, burn, xStocks, live
rialto sol receipts [-n 20] [--since <date>] [--json]   # every payment this kit signed, from ~/.rialto/receipts.jsonl: totals, by host, signatures
rialto history              # growth day by day since launch, and who holds how much by tier
rialto vitals               # measured chain vitals: blocks per second, block time, fee of one transfer
rialto rank [address]       # where a wallet stands: rank, wallet number since launch, days held, never sold, day one, badge
rialto leaderboard [-n 25]  # top holders with rank and first day; diamond hands, day-one still holding, exited, median
rialto badge [address]      # badge URL, Markdown for a README, the SVG (-o file.svg)
rialto share [address]      # share text and X post link for a wallet (--open)
```

MCP tools: `hood_usdg_transfers`, `hood_recent_trades`. Hosted equivalents: https://rialto.casa/api/live/transfers, /api/live/trades?token=NVDA, /api/live/pulse, and the live page https://rialto.casa/live.

## Pay per call and the flywheel

rialto.casa sells its tools over x402 in USDG on Robinhood Chain. Pay with the wallet, no tier needed:

```
rialto pay https://rialto.casa/x402/check/0xe0fb5d77c627ba9c7950fc0d62d1d96603e7b7c6 --max 0.05
rialto pay https://rialto.casa/x402/pulse --max 0.05
rialto pay https://rialto.casa/x402/pulse --burn   # pay in Rialto: burns the price, the tx is the receipt
rialto flywheel               # revenue received, Rialto bought back and burned
rialto burn 10000 --yes       # IRREVERSIBLE: 10,000 Rialto to the dead address = 24 h of Pro for this wallet
```

MCP tools: `rialto_flywheel`, `rialto_burn` (confirm with the user before calling).

On rialto.casa the kit signs you in automatically, so a Holder wallet pays 50% and a Pro wallet 25% of the list price on the paid lane.
