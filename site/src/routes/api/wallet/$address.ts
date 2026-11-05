import { createFileRoute } from "@tanstack/react-router";
import { walletReport } from "../../../lib/hood.server";
import { cors, guard } from "../../../lib/json.server";

export const Route = createFileRoute("/api/wallet/$address")({
  server: { handlers: { GET: ({ params, request }) => guard(() => walletReport(params.address), request), OPTIONS: () => cors() } },
});
