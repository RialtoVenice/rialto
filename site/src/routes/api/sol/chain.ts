import { createFileRoute } from "@tanstack/react-router";
import { solChain } from "../../../lib/sol.server";
import { cors, guard } from "../../../lib/json.server";

export const Route = createFileRoute("/api/sol/chain")({
  server: { handlers: { GET: ({ request }) => { return guard(() => solChain(), request); }, OPTIONS: () => cors() } },
});
