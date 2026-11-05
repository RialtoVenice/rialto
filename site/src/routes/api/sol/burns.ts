import { createFileRoute } from "@tanstack/react-router";
import { solBurns } from "../../../lib/sol.server";
import { cors, guard } from "../../../lib/json.server";

export const Route = createFileRoute("/api/sol/burns")({
  server: { handlers: { GET: ({ request }) => { const q = new URL(request.url).searchParams; return guard(() => solBurns(q.get("mint"), Number(q.get("scan") ?? 100)), request); }, OPTIONS: () => cors() } },
});
