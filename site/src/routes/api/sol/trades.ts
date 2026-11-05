import { createFileRoute } from "@tanstack/react-router";
import { solTrades } from "../../../lib/sol.server";
import { cors, guard } from "../../../lib/json.server";

export const Route = createFileRoute("/api/sol/trades")({
  server: { handlers: { GET: ({ request }) => { const q = new URL(request.url).searchParams; return guard(() => solTrades(q.get("mint"), Number(q.get("limit") ?? 40)), request); }, OPTIONS: () => cors() } },
});
