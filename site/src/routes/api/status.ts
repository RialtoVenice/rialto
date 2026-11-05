import { createFileRoute } from "@tanstack/react-router";
import { cors, guard } from "../../lib/json.server";
import { status } from "../../lib/status.server";

/** Health of the RPC pool, GeckoTerminal, Venice, the bridges and the explorer, probed on request. */
export const Route = createFileRoute("/api/status")({
  server: { handlers: { GET: ({ request }) => guard(() => status(), request), OPTIONS: () => cors() } },
});
