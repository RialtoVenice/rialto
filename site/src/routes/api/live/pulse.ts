import { createFileRoute } from "@tanstack/react-router";
import { pulse } from "../../../lib/hood.server";
import { cors, guard } from "../../../lib/json.server";

export const Route = createFileRoute("/api/live/pulse")({
  server: { handlers: { GET: ({ request }) => guard(() => pulse(), request), OPTIONS: () => cors() } },
});
