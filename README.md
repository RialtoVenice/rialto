# Rialto

Venice AI agent kit on Solana, and the site that serves it. One wallet that pays for x402 endpoints in USDC and funds private Venice AI inference from the same USDC, with every spend capped in code.

- Site, API, MCP and docs: https://rialto.casa
- Updates: https://x.com/RialtoVenice

| Folder | What it is |
|---|---|
| [`kit/`](kit/) | The `rialto` CLI, MCP server and reference agent (TypeScript, MIT). Builds with `npm install && npm run build`. |
| [`site/`](site/) | Source of rialto.casa: the public API routes (`/api/sol/*`, `/x402/*`, `/mcp`, `/llms.txt`), the pages and the Vercel adapter. |

## Quick start

```bash
npm i -g https://rialto.casa/downloads/rialto-kit-0.13.0.tgz
rialto sol init
rialto sol status
rialto agent "What is the Rialto supply and who are the top holders?" -b 0.10 --cap sol_pay=0.02
```

## License

MIT, see [LICENSE](LICENSE).
