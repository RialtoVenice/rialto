import { createFileRoute } from "@tanstack/react-router";
import { tokenStats, tokenVolume } from "../../../lib/hood.server";
import { cors, guard } from "../../../lib/json.server";
import { TOKEN_CA } from "../../../lib/site";

export const Route = createFileRoute("/api/token/")({
  server: {
    handlers: {
      GET: ({ request }) =>
        guard(async () => {
          const [stats, volume] = await Promise.all([tokenStats(TOKEN_CA), tokenVolume().catch(() => null)]);
          return { ...stats, volume };
        }, request),
      OPTIONS: () => cors(),
    },
  },
});
