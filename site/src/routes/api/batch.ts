import { createFileRoute } from "@tanstack/react-router";
import { cors, guard, json } from "../../lib/json.server";
import { handleRpc } from "../../lib/mcp.server";

/** Pro tier: POST {calls:[{tool,args}]} (max 20) and get every result in one round trip. */
export const Route = createFileRoute("/api/batch")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: { calls?: unknown };
        try {
          body = (await request.json()) as { calls?: unknown };
        } catch {
          return json({ ok: false, error: "Body must be JSON: {calls:[{tool,args}]}" }, 400);
        }
        return guard(
          async (access) => {
            const r = (await handleRpc({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "hood_batch", arguments: { calls: body.calls } } }, access)) as { result?: { content: { text: string }[]; isError: boolean } };
            if (!r.result) throw new Error("batch failed");
            if (r.result.isError) throw new Error(r.result.content[0]?.text ?? "batch failed");
            return JSON.parse(r.result.content[0].text) as unknown;
          },
          request,
          { tier: "Pro", what: "POST /api/batch" },
        );
      },
      OPTIONS: () => cors(),
    },
  },
});
