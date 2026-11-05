import { createFileRoute } from "@tanstack/react-router";
import { walletRank } from "../../../../lib/hood.server";
import { cors, guard } from "../../../../lib/json.server";

export const Route = createFileRoute("/api/token/wallet/$address")({
  server: { handlers: { GET: ({ params, request }) => guard(() => walletRank(params.address), request), OPTIONS: () => cors() } },
});
