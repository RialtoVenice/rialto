import { createFileRoute } from "@tanstack/react-router";
import { accessHeaders, isLimited, limitMessage, resolveAccess } from "../../lib/access.server";
import { cors, json } from "../../lib/json.server";
import { PLAYGROUND_MODELS, VENICE_CHAT_URL, proxyChat } from "../../lib/venice-proxy.server";

/**
 * POST {siwx, messages, model?, live?, wallet?, webSearch?}. siwx is the base64 SIGN-IN-WITH-X header the caller's
 * wallet signed for VENICE_CHAT_URL. The server forwards it once and keeps nothing.
 */
export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      GET: () => json({ ok: true, data: { resource: VENICE_CHAT_URL, models: PLAYGROUND_MODELS, how: "Sign a SIWE message (domain api.venice.ai, chainId 8453, uri = resource, 5 minute expiry) and POST it as siwx with your messages." } }),
      POST: async ({ request }) => {
        const access = await resolveAccess(request, 1);
        const extra = accessHeaders(access);
        if (isLimited(access)) return json({ ok: false, error: limitMessage(access) }, 429, extra);
        let body: Parameters<typeof proxyChat>[0];
        try {
          body = (await request.json()) as Parameters<typeof proxyChat>[0];
        } catch {
          return json({ ok: false, error: "Body must be JSON" }, 400, extra);
        }
        if (typeof body.siwx !== "string" || body.siwx.length < 100) return json({ ok: false, error: "siwx (signed SIGN-IN-WITH-X header) is required" }, 400, extra);
        try {
          const r = await proxyChat(body);
          return json(r.ok ? { ok: true, data: r } : { ok: false, error: r.error, data: r }, r.ok ? 200 : r.status === 402 ? 402 : 400, extra);
        } catch (e) {
          return json({ ok: false, error: (e as Error).message }, 400, extra);
        }
      },
      OPTIONS: () => cors(),
    },
  },
});
