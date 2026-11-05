import { createFileRoute } from "@tanstack/react-router";
import { tokenCheck } from "../../../lib/hood.server";
import { PRICES, paid, x402Options } from "../../../lib/x402.server";

/** Pay-per-call token check: 0.02 USDG on Robinhood Chain, no tier, no rate limit. */
export const Route = createFileRoute("/x402/check/$address")({
  server: { handlers: { GET: ({ params, request }) => paid(request, PRICES.check, `Rialto token check for ${params.address}`, () => tokenCheck(params.address)), OPTIONS: () => x402Options() } },
});
