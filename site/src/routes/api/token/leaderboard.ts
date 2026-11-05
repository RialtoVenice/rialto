import { createFileRoute } from "@tanstack/react-router";
import { leaderboard } from "../../../lib/hood.server";
import { cors, guard } from "../../../lib/json.server";

export const Route = createFileRoute("/api/token/leaderboard")({
  server: {
    handlers: {
      GET: ({ request }) => {
        const limit = Number(new URL(request.url).searchParams.get("limit") ?? 25);
        return guard(() => leaderboard(Number.isFinite(limit) ? limit : 25), request);
      },
      OPTIONS: () => cors(),
    },
  },
});
