import { createFileRoute } from "@tanstack/react-router";
import { tokenOhlcv } from "../../../lib/hood.server";
import { cors, guard } from "../../../lib/json.server";

/** Hourly candles for the Rialto pool. */
export const Route = createFileRoute("/api/token/ohlcv")({
  server: { handlers: { GET: ({ request }) => guard(() => tokenOhlcv(Number(new URL(request.url).searchParams.get("hours") ?? 24)), request), OPTIONS: () => cors() } },
});
