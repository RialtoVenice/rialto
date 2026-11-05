import { createFileRoute } from "@tanstack/react-router";
import { pulse } from "../../lib/hood.server";
import { PRICES, paid, x402Options } from "../../lib/x402.server";

/** Pay-per-call live pulse: 0.005 USDG. */
export const Route = createFileRoute("/x402/pulse")({
  server: { handlers: { GET: ({ request }) => paid(request, PRICES.pulse, "Rialto live pulse of Robinhood Chain", () => pulse()), OPTIONS: () => x402Options() } },
});
