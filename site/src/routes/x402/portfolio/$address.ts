import { createFileRoute } from "@tanstack/react-router";
import { portfolio } from "../../../lib/hood.server";
import { PRICES, paid, x402Options } from "../../../lib/x402.server";

/** Pay-per-call portfolio: 0.01 USDG, no Holder tier needed. */
export const Route = createFileRoute("/x402/portfolio/$address")({
  server: { handlers: { GET: ({ params, request }) => paid(request, PRICES.portfolio, `Rialto portfolio for ${params.address}`, () => portfolio(params.address)), OPTIONS: () => x402Options() } },
});
