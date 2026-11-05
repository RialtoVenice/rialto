import { createFileRoute } from "@tanstack/react-router";
import { solTokenStats } from "../../../lib/sol.server";
import { cors, guard } from "../../../lib/json.server";

export const Route = createFileRoute("/api/sol/token")({
  server: { handlers: { GET: ({ request }) => { const q = new URL(request.url).searchParams; return guard(() => solTokenStats(q.get("mint")), request); }, OPTIONS: () => cors() } },
});
