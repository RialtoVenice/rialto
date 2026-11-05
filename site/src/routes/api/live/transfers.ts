import { createFileRoute } from "@tanstack/react-router";
import { usdgTransfers } from "../../../lib/hood.server";
import { cors, guard } from "../../../lib/json.server";

/** USDG transfers from the last N blocks (default 120, max 400): count, volume, largest, latest. */
export const Route = createFileRoute("/api/live/transfers")({
  server: {
    handlers: {
      GET: ({ request }) => {
        const u = new URL(request.url);
        return guard(() => usdgTransfers(Number(u.searchParams.get("blocks") ?? 120), Number(u.searchParams.get("limit") ?? 40)), request);
      },
      OPTIONS: () => cors(),
    },
  },
});
