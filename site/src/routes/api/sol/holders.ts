import { createFileRoute } from "@tanstack/react-router";
import { solHolders } from "../../../lib/sol.server";
import { cors, guard } from "../../../lib/json.server";

export const Route = createFileRoute("/api/sol/holders")({
  server: { handlers: { GET: ({ request }) => { const q = new URL(request.url).searchParams; return guard(() => solHolders(q.get("mint"), Number(q.get("top") ?? 10)), request); }, OPTIONS: () => cors() } },
});
