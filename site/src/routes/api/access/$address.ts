import { createFileRoute } from "@tanstack/react-router";
import { rialtoBalance } from "../../../lib/hood.server";
import { cors, guard } from "../../../lib/json.server";
import { TIERS, tierFor } from "../../../lib/tiers";

/** Public: the tier an address would get from its Rialto balance (no signature, read-only). */
export const Route = createFileRoute("/api/access/$address")({
  server: {
    handlers: {
      GET: ({ params, request }) =>
        guard(async () => {
          const b = Number((await rialtoBalance(params.address)).balance);
          const t = tierFor(b);
          const next = TIERS.filter((x) => x.min > b).sort((x, y) => x.min - y.min)[0] ?? null;
          return {
            address: params.address,
            rialtoBalance: b,
            tier: t.name,
            requestsPerMinute: t.rpm,
            unlocks: t.unlocks,
            nextTier: next ? { name: next.name, minRialto: next.min, missing: Math.max(0, next.min - b) } : null,
            tiers: TIERS.map((x) => ({ name: x.name, minRialto: x.min, requestsPerMinute: x.rpm })),
          };
        }, request),
      OPTIONS: () => cors(),
    },
  },
});
