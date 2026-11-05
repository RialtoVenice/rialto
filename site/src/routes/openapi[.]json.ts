import { createFileRoute } from "@tanstack/react-router";
import { openapi } from "../lib/openapi.server";
import { requestOrigin } from "../lib/origin.server";

export const Route = createFileRoute("/openapi.json")({
  server: {
    handlers: {
      GET: () =>
        new Response(JSON.stringify(openapi(requestOrigin()), null, 2), {
          headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=300", "access-control-allow-origin": "*" },
        }),
    },
  },
});
