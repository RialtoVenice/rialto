import { createFileRoute } from "@tanstack/react-router";
import { portfolio } from "../../../lib/hood.server";
import { cors, guard } from "../../../lib/json.server";

/** Holder tier: the whole wallet valued in USD. */
export const Route = createFileRoute("/api/portfolio/$address")({
  server: { handlers: { GET: ({ params, request }) => guard(() => portfolio(params.address), request, { tier: "Holder", what: "GET /api/portfolio" }), OPTIONS: () => cors() } },
});
