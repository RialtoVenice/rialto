import { createFileRoute } from "@tanstack/react-router";
import { tokenCheck } from "../../../lib/hood.server";
import { cors, guard } from "../../../lib/json.server";

/** Token check for any contract on Robinhood Chain: identity, supply, age, holders, concentration, liquidity, flags. */
export const Route = createFileRoute("/api/check/$address")({
  server: { handlers: { GET: ({ params, request }) => guard(() => tokenCheck(params.address), request, { cost: 2 }), OPTIONS: () => cors() } },
});
