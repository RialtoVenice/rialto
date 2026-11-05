import { createFileRoute } from "@tanstack/react-router";
import { solRank, solWallet } from "../../../../lib/sol.server";
import { cors, guard } from "../../../../lib/json.server";

export const Route = createFileRoute("/api/sol/wallet/$address")({
  server: { handlers: { GET: ({ params, request }) => { const q = new URL(request.url).searchParams; return guard(async () => ({ ...(await solWallet(params.address, q.get("mint"))), rank: await solRank(params.address, q.get("mint")).catch(() => null) }), request); }, OPTIONS: () => cors() } },
});
