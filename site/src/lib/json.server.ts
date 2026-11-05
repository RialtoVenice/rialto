import { accessHeaders, describeAccess, isLimited, limitMessage, requireTier, resolveAccess, type Access } from "./access.server";
import type { TierName } from "./tiers";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type, mcp-session-id, mcp-protocol-version, accept, x-rialto-auth, authorization",
  "access-control-allow-methods": "GET, POST, OPTIONS",
};

export function json(data: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...CORS, ...extra },
  });
}

export function cors(): Response {
  return new Response(null, { status: 204, headers: CORS });
}

/**
 * Run a read handler with the caller's tier applied: rate limit per tier, optional minimum tier, tier headers on
 * every response. Without a request the handler runs unlimited (server-side rendering).
 */
export async function guard(fn: (access: Access | null) => Promise<unknown>, request?: Request, opts: { tier?: TierName; what?: string; cost?: number } = {}): Promise<Response> {
  let access: Access | null = null;
  let extra: Record<string, string> = {};
  if (request) {
    access = await resolveAccess(request, opts.cost ?? 1);
    extra = accessHeaders(access);
    if (isLimited(access)) return json({ ok: false, error: limitMessage(access), access: describeAccess(access) }, 429, { ...extra, "retry-after": String(access.resetSeconds) });
    if (opts.tier) {
      try {
        requireTier(access, opts.tier, opts.what ?? "This endpoint");
      } catch (e) {
        return json({ ok: false, error: (e as Error).message, access: describeAccess(access) }, 403, extra);
      }
    }
  }
  try {
    const anonymousGet = !!request && request.method === "GET" && !request.headers.get("x-rialto-auth") && !request.headers.get("authorization") && !new URL(request.url).searchParams.get("auth");
    const cache: Record<string, string> = anonymousGet ? { "cache-control": "public, s-maxage=15, stale-while-revalidate=45" } : {};
    return json({ ok: true, data: await fn(access) }, 200, { ...extra, ...cache });
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 400, extra);
  }
}
