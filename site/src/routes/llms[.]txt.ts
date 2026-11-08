import { createFileRoute } from "@tanstack/react-router";
import { requestOrigin } from "../lib/origin.server";

/** llms.txt: what an agent needs to know about Rialto in one plain-text page. */
export const Route = createFileRoute("/llms.txt")({
  server: {
    handlers: {
      GET: () => {
        const o = requestOrigin();
        const body = [
          "# Rialto",
          "",
          "> Venice AI agent kit for Solana. One wallet on Solana pays x402 endpoints in USDC and funds private Venice AI inference from the same address. CLI, local MCP server, budgeted reference agent. MIT. Independent project, not affiliated with Venice AI or the Solana Foundation.",
          "",
          "## Facts",
          "- Chain: Solana mainnet (CAIP-2 solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp). Dollar: USDC EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v (6 decimals).",
          "- Venice x402: prepaid USD ledger per address; Venice's own top-up endpoint accepts USDC on Solana (exact scheme, facilitator pays the fee). The kit tops up with `rialto sol fund <usd>` (minimum 5).",
          "- x402 payments: `rialto sol pay <url>` answers a 402 that offers USDC on Solana with a signed transfer; per-payment ceiling maxPaymentUsdg (dollars), optional host allowlist.",
          "- Rialto token: a new mint on Solana, published on this site and on X the day it goes live. Set it with `rialto sol config mint <address>`.",
          "",
          "## Local kit",
          `- Tarball: ${o}/downloads/rialto-kit-0.12.1.tgz (npm i -g, or npx <tarball> sol init). Skill file: ${o}/downloads/SKILL.md. Source: ${o}/downloads/rialto-kit-source.zip.`,
          "- Solana commands: sol init, sol status, sol address, sol config mint, sol token, sol holders, sol burns, sol trades, sol stock, sol send, sol burn, sol fund, sol pay, sol watch.",
          "- Payment ledger: rialto sol receipts [-n 20] [--since date] [--json]; every x402 payment and Venice top-up the kit signed, from ~/.rialto/receipts.jsonl. MCP and agent tool: sol_receipts.",
          "- Venice commands: chat, agent [-b usd] [--cap tool=usd ...], venice balance | ledger | models | search. Also: mcp, skill, config (toolCaps).",
          "- Local MCP: npx -y <tarball> mcp. Tools: sol_status, sol_token, sol_holders, sol_burns, sol_trades, sol_stock, sol_pay, sol_fund, sol_send, sol_burn, venice_chat, venice_web_search, rialto_agent.",
          "- Environment: SOLANA_RPC_URL (private endpoint for burn scans), RIALTO_SOLANA_MINT, SOLANA_SECRET_KEY (base58), VENICE_API_KEY (key mode).",
          "",
          "## Pages",
          `- ${o}/ home, ${o}/docs, ${o}/playground`,
          "- Source (MIT): https://github.com/RialtoVenice/rialto",
          "- X: https://x.com/RialtoVenice",
          "",
        ].join("\n");
        return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=300", "access-control-allow-origin": "*" } });
      },
    },
  },
});
