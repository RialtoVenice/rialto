import { createFileRoute } from "@tanstack/react-router";
import { describeAccess } from "../../../lib/access.server";
import { cors, guard } from "../../../lib/json.server";

/** Your tier, from the access token you send (x-rialto-auth, Authorization: Bearer, or ?auth=). Without one: Free. */
export const Route = createFileRoute("/api/access/")({
  server: { handlers: { GET: ({ request }) => guard(async (a) => (a ? describeAccess(a) : { tier: "Free" }), request, { cost: 0 }), OPTIONS: () => cors() } },
});
