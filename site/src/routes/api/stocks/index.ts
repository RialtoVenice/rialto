import { createFileRoute } from "@tanstack/react-router";
import { STOCK_REGISTRY, stockFind } from "../../../lib/hood.server";
import { cors, guard, json } from "../../../lib/json.server";

export const Route = createFileRoute("/api/stocks/")({
  server: {
    handlers: {
      GET: ({ request }) => {
        const q = new URL(request.url).searchParams.get("q");
        if (q) return guard(() => stockFind(q), request);
        return json({ ok: true, data: STOCK_REGISTRY });
      },
      OPTIONS: () => cors(),
    },
  },
});
