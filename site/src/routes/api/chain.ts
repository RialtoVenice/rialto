import { createFileRoute } from "@tanstack/react-router";
import { chainStatus } from "../../lib/hood.server";
import { cors, guard } from "../../lib/json.server";

export const Route = createFileRoute("/api/chain")({
  server: { handlers: { GET: ({ request }) => guard(chainStatus, request), OPTIONS: () => cors() } },
});
