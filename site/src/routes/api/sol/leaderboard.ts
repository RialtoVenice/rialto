import { createFileRoute } from "@tanstack/react-router";
import { solLeaderboard } from "../../../lib/sol.server";
import { cors, guard } from "../../../lib/json.server";

export const Route = createFileRoute("/api/sol/leaderboard")({
  server: { handlers: { GET: ({ request }) => { const q = new URL(request.url).searchParams; return guard(() => solLeaderboard(q.get("mint"), Number(q.get("limit") ?? 25)), request); }, OPTIONS: () => cors() } },
});
