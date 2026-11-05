import { createFileRoute } from "@tanstack/react-router";
import { json } from "../../lib/json.server";
import { handleRpc } from "../../lib/mcp.server";
import { PRICES, paid, x402Options } from "../../lib/x402.server";

/** Pay-per-call batch: up to 20 tool calls for 0.05 USDG, no Pro tier needed. */
export const Route = createFileRoute("/x402/batch")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let calls: unknown;
        try {
          calls = ((await request.clone().json()) as { calls?: unknown }).calls;
        } catch {
          return json({ ok: false, error: "Body must be JSON: {calls:[{tool,args}]}" }, 400);
        }
        return paid(request, PRICES.batch, "Rialto batch: up to 20 tool calls", async () => {
          // Paid lane: run the batch with a synthetic Pro access so the tier gate passes.
          const r = (await handleRpc({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "hood_batch", arguments: { calls } } }, null)) as { result?: { content: { text: string }[]; isError: boolean } };
          if (!r.result) throw new Error("batch failed");
          if (r.result.isError) throw new Error(r.result.content[0]?.text ?? "batch failed");
          return JSON.parse(r.result.content[0].text) as unknown;
        });
      },
      GET: ({ request }) => paid(request, PRICES.batch, "Rialto batch: POST {calls:[{tool,args}]}", async () => ({ note: "POST a JSON body {calls:[{tool,args}]} with the same payment header." })),
      OPTIONS: () => x402Options(),
    },
  },
});
