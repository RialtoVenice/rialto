import { createFileRoute } from "@tanstack/react-router";
import { topPools } from "../../lib/hood.server";
import { cors, guard } from "../../lib/json.server";

export const Route = createFileRoute("/api/pools")({
  server: {
    handlers: {
      GET: ({ request }) => {
        const limit = Number(new URL(request.url).searchParams.get("limit") ?? "10");
        return guard(() => topPools(Number.isFinite(limit) ? limit : 10), request);
      },
      OPTIONS: () => cors(),
    },
  },
});
