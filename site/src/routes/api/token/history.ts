import { createFileRoute } from "@tanstack/react-router";
import { tokenHistory } from "../../../lib/hood.server";
import { cors, guard } from "../../../lib/json.server";

export const Route = createFileRoute("/api/token/history")({
  server: { handlers: { GET: ({ request }) => guard(tokenHistory, request), OPTIONS: () => cors() } },
});
