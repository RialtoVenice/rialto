# rialto.casa

Source of the site: a TanStack Start app rendered on the server, deployed on Vercel through `deploy/api/server.mjs`.

What is here:

- `src/routes/api/sol/*`: the public Solana API (token, holders, burns, trades, ticker, leaderboard, wallet). Every route takes `?mint=` and defaults to the Rialto mint.
- `src/routes/x402/*`: the paid lane (402 with a Solana option).
- `src/routes/mcp.ts`, `src/lib/mcp.server.ts`: the hosted read-only MCP endpoint.
- `src/routes/llms[.]txt.ts`, `openapi[.]json.ts`: machine-readable docs.
- `src/lib/sol.server.ts`: RPC reads, holder scans, burn scans, GeckoTerminal prices.
- `src/routes/*.tsx`: the pages (home, docs, live, explore, status, playground).
- `public/downloads/`: the kit tarballs served by the site.

Environment: `SOLANA_RPC_URL` (private RPC for full holder scans and burn history), `RIALTO_SOLANA_MINT` (overrides the mint in `src/lib/site.ts`).

The app was scaffolded on a Higgsfield TanStack Start template whose private UI packages (`@higgsfield/quanta`, `@higgsfield/fnf`) are not redistributed here, so this folder is the Rialto source for reading and reuse rather than a one-command standalone build. The API routes and `src/lib` have no dependency on those packages.
