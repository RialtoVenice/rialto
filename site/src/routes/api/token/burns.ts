import { createFileRoute } from "@tanstack/react-router";
import { tokenBurns } from "../../../lib/hood.server";
import { cors, guard } from "../../../lib/json.server";

/** Every burn of the Rialto token, from the chain. */
export const Route = createFileRoute("/api/token/burns")({
  server: { handlers: { GET: ({ request }) => guard(() => tokenBurns(), request), OPTIONS: () => cors() } },
});
