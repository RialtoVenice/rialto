import { createFileRoute } from "@tanstack/react-router";
import { stockPrice } from "../../../lib/hood.server";
import { cors, guard } from "../../../lib/json.server";

export const Route = createFileRoute("/api/stocks/$symbol")({
  server: { handlers: { GET: ({ params, request }) => guard(() => stockPrice(params.symbol), request), OPTIONS: () => cors() } },
});
