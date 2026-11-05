import { createFileRoute } from "@tanstack/react-router";
import { flywheel } from "../../lib/hood.server";
import { cors, guard } from "../../lib/json.server";

/** Revenue, buybacks and burns of the Rialto treasury, read from the chain. */
export const Route = createFileRoute("/api/flywheel")({
  server: { handlers: { GET: ({ request }) => guard(() => flywheel(), request), OPTIONS: () => cors() } },
});
