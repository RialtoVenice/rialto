import { createFileRoute } from "@tanstack/react-router";
import { tokenHolders } from "../../../lib/hood.server";
import { cors, guard } from "../../../lib/json.server";

/** Holder statistics from the full transfer history. */
export const Route = createFileRoute("/api/token/holders")({
  server: { handlers: { GET: ({ request }) => guard(() => tokenHolders(Number(new URL(request.url).searchParams.get("top") ?? 10)), request), OPTIONS: () => cors() } },
});
