import { createFileRoute } from "@tanstack/react-router";
import { json } from "../../lib/json.server";
import { ENDPOINTS } from "../../lib/openapi.server";
import { requestOrigin } from "../../lib/origin.server";
import { TIERS } from "../../lib/tiers";

/** Human and agent readable index of the hosted API. */
export const Route = createFileRoute("/api/")({
  server: {
    handlers: {
      GET: () => {
        const origin = requestOrigin();
        return json({
          ok: true,
          data: {
            name: "Rialto hosted API",
            openapi: `${origin}/openapi.json`,
            llms: `${origin}/llms.txt`,
            mcp: `${origin}/mcp`,
            docs: `${origin}/docs`,
            tiers: TIERS.map((t) => ({ name: t.name, minRialto: t.min, requestsPerMinute: t.rpm })),
            endpoints: ENDPOINTS.map((e) => ({ method: (e.method ?? "get").toUpperCase(), path: e.path, summary: e.summary, tier: e.tier ?? "Free" })),
          },
        });
      },
    },
  },
});
