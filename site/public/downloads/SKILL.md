---
name: rialto
description: Venice AI agent kit on Solana. Use when an agent needs its own Solana wallet, has to pay x402 endpoints in USDC, fund and call Venice AI from that same wallet without an API key, or read an SPL mint on Solana (supply, authorities, holders, burns, trades) from the chain.
---

# Rialto

Rialto gives an agent one Solana keypair that pays for everything it uses:

- **USDC payments** to any x402 endpoint that offers a Solana option (`exact` scheme, USDC mint `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`). The facilitator named in the 402 pays the network fee: no SOL leaves the wallet for a payment.
- **Venice AI inference** paid from that same keypair: `rialto sol fund <usd>` tops up the wallet's Venice credit straight from its USDC, and every Venice call carries a fresh `SIGN-IN-WITH-X` header signed by the keypair (ed25519). The wallet that pays is the wallet that signs in. No API key.
- **Solana reads** with no indexer: balances, any SPL mint (supply, mint and freeze authorities, holders by full scan, burns, trade tape), tokenized stocks (xStocks).

## Install

```bash
npm i -g https://rialto.casa/downloads/rialto-kit-0.14.0.tgz
rialto sol init              # creates the keypair in ~/.rialto/config.json (mode 600)
```

Send USDC to the printed address (a little SOL only for `sol send` and `sol burn`), then `rialto sol fund 5`.

Source: https://github.com/RialtoVenice/rialto

## Commands

| Command | What it does |
|---|---|
| `rialto sol init` | Create or show the Solana keypair. The secret never leaves the config file. |
| `rialto sol status [address]` | SOL, USDC and Rialto balances, current slot; for this wallet, its Venice credit too. |
| `rialto sol fund <usd>` | Top up Venice from this wallet's USDC (Venice minimum: 5). No bridge, no SOL fee. |
| `rialto chat "<prompt>" [--web] [-m model]` | Ask a Venice model, paid from the wallet's Venice credit. |
| `rialto agent "<goal>" -b <usd> [--cap tool=usd] [-s 8]` | Budgeted reference agent with Solana tools and x402 payments. Stops on an answer, on the budget, or at step 8. |
| `rialto sol pay <url> [--dry-run] [--max <usd>]` | Fetch a URL and pay in USDC if it answers 402 with a Solana option. `--dry-run` shows the requirement and signs nothing. |
| `rialto sol receipts [-n 20] [--since <date>] [--json]` | Every payment this kit signed, from `~/.rialto/receipts.jsonl`: totals, by host, signatures, signed today. |
| `rialto sol token [mint]` | Mint facts: supply, decimals, mint and freeze authorities, burn since launch, 20 largest accounts with owners, price and pool. |
| `rialto sol holders [mint] -n 20` | Holders by wallet: full scan when the RPC allows it, else the 20 largest with `complete: false`. |
| `rialto sol burns [mint]` | Burn instructions in the mint's recent transactions, with amounts and signatures. |
| `rialto sol trades [mint]` | Trade tape of the deepest pool, last hour totals. |
| `rialto sol stock <symbol>` | Tokenized stock on Solana (AAPLx, TSLAx, NVDAx): mint, USD price, deepest pool. |
| `rialto sol send <to> <amount> --yes [--sol \| --rialto]` | Send USDC, SOL or Rialto. Creates the recipient's token account if missing. Irreversible. |
| `rialto sol burn <amount> --yes` | Burn Rialto (BurnChecked). Irreversible. |
| `rialto sol watch [--json]` | Follow slot, balances and the Rialto trade tape live. |
| `rialto venice balance` / `ledger` / `models` / `search "<q>"` | Venice credit of the wallet that signs in, ledger entries, models, private web search. |
| `rialto mcp` | MCP server on stdio. |
| `rialto config [key] [value]` | `defaultModel`, `agentBudgetUsd`, `maxPaymentUsdg`, `dailyLimitUsd`, `payAllowlist`, `toolCaps`, `veniceWallet`, `veniceApiKey`. |

The Rialto mint is `8h88ucUAF5o6CEr8rphy9rwNPD7gt2qBEmCv81SCpump` (Token-2022, 6 decimals, mint and freeze authority null). Every `sol` read takes another mint as argument.

## MCP

Local, full tools, has the wallet:

```json
{ "mcpServers": { "rialto": { "command": "rialto", "args": ["mcp"] } } }
```

Hosted, read-only, no install, no wallet on the server: `https://rialto.casa/mcp` (Streamable HTTP, stateless).

Solana tools of the local server: `sol_status`, `sol_token`, `sol_holders`, `sol_burns`, `sol_trades`, `sol_stock`, `sol_receipts`, `sol_pay`, `sol_fund`, `sol_send`, `sol_burn`. Venice: `venice_chat`, `venice_web_search`, `venice_models`, `venice_balance`, `venice_transactions`. Agent: `rialto_agent`.

## Guardrails an agent must respect

All enforced locally, before any signature:

- `agentBudgetUsd` (default 1, `-b`) caps one `rialto agent` run: inference measured from Venice's `X-Balance-Remaining` header plus every x402 payment the run made.
- `toolCaps` (`--cap tool=usd`) caps each tool inside a run: `sol_pay` is refused once its cap is spent, `venice` stops inference at its cap.
- `maxPaymentUsdg` (default 1, `--max`) caps one x402 payment. A per-tool cap never loosens it: the payer applies the tighter of the two, the per-payment ceiling or what is left on the cap.
- `dailyLimitUsd` (unset by default; `rialto config dailyLimitUsd 2`) caps the x402 payments signed per UTC day across every run, the CLI and the MCP server. A payment that would cross it is refused before signing.
- `payAllowlist` restricts the hosts the payer may pay. Payments go to HTTPS endpoints only, and only to an offer naming the USDC mint.
- A refused tool answers with an error. Do not retry it: report it and finish with what you have.
- `sol_send`, `sol_burn` and `sol_fund` move real funds. Confirm with the user before calling them.
- Every payment signed is appended to `~/.rialto/receipts.jsonl`. Read it with `rialto sol receipts` or `sol_receipts` before and after a run that pays.
- The secret key never leaves `~/.rialto/config.json` (mode 600) or `SOLANA_SECRET_KEY`.

## Configuration

`~/.rialto/config.json`, or environment variables. `RIALTO_HOME` moves the folder.

| Key | Env | Default |
|---|---|---|
| `solanaSecret` | `SOLANA_SECRET_KEY` | generated by `sol init` |
| `solanaMint` | `RIALTO_SOLANA_MINT` | the Rialto mint |
| | `SOLANA_RPC_URL` | public RPC; set a private one for full holder scans and burn history |
| `veniceWallet` | `RIALTO_VENICE_WALLET` | `solana` when a Solana key exists; `evm` signs in with the EVM key instead |
| `veniceApiKey` | `VENICE_API_KEY` | unset; an API key replaces the wallet ledger |
| `defaultModel` | `RIALTO_MODEL` | `zai-org-glm-5-2` |
| `agentBudgetUsd` | `RIALTO_AGENT_BUDGET_USD` | `1` |
| `maxPaymentUsdg` | `RIALTO_MAX_PAYMENT_USDG` | `1` |
| `dailyLimitUsd` | `RIALTO_DAILY_LIMIT_USD` | unset |
| `toolCaps`, `payAllowlist` | | unset |

## Facts the code relies on

- Venice x402 (verified against api.venice.ai on 2026-11-13): prepaid USD ledger per wallet, top-up in USDC on Solana mainnet (`solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp`), minimum 5 USD. Sign-in header `SIGN-IN-WITH-X`: Venice lists `ed25519` on Solana among its supported sign-in types; the kit signs the CAIP-122 message for Solana, base58 signature, random nonce, 5-minute expiry.
- x402 `exact` on Solana: a versioned transaction with exactly three instructions (compute-unit limit, compute-unit price, one `transferChecked` of USDC), fee payer = the facilitator named in `extra.feePayer`.
- Holder counts come from `getProgramAccounts` on the token program filtered by mint, empty accounts dropped, grouped by owner. Public RPC endpoints may refuse or throttle it.

## First chain

The kit started on an EVM network (chain id 4663) and still ships those commands under their original names (`status`, `pay`, `fund`, `bridge`, `token`, `holders`, `watch`, ...). `rialto --help` lists them. The project lives on Solana now.
