import { createFileRoute } from "@tanstack/react-router";
import { recentTrades } from "../../../lib/hood.server";
import { cors, guard } from "../../../lib/json.server";

/** Recent trades: ?token=RIALTO|AAPL|TSLA|NVDA|<ticker>|<pool>, ?limit=40. */
export const Route = createFileRoute("/api/live/trades")({
  server: {
    handlers: {
      GET: ({ request }) => {
        const u = new URL(request.url);
        return guard(() => recentTrades(u.searchParams.get("token") ?? "RIALTO", Number(u.searchParams.get("limit") ?? 40)), request);
      },
      OPTIONS: () => cors(),
    },
  },
});
