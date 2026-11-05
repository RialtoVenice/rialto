import { createFileRoute } from "@tanstack/react-router";
import { walletBadge } from "../../lib/hood.server";

/** Embeddable badge: rank, balance and diamond-hands flag of a wallet, read from the ledger. */
export const Route = createFileRoute("/badge/$address.svg")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        try {
          const raw = (params as Record<string, string>)["address.svg"] ?? (params as Record<string, string>).address ?? "";
          const svg = await walletBadge(raw.replace(/\.svg$/i, ""));
          return new Response(svg, { headers: { "content-type": "image/svg+xml; charset=utf-8", "cache-control": "public, max-age=120, s-maxage=120", "access-control-allow-origin": "*" } });
        } catch (e) {
          return new Response((e as Error).message, { status: 400, headers: { "content-type": "text/plain" } });
        }
      },
    },
  },
});
