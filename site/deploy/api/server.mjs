// Vercel Node function that runs the same server bundle as the Cloudflare Worker.
import server from "../server/server.js";

export const config = { supportsResponseStreaming: true };

async function handle(request) {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "rialto.casa";
  const proto = request.headers.get("x-forwarded-proto") ?? "https";
  const url = new URL(request.url, `${proto}://${host}`);
  const init = { method: request.method, headers: request.headers };
  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = request.body;
    init.duplex = "half";
  }
  const req = new Request(url, init);
  return server.fetch(req, {}, { waitUntil() {}, passThroughOnException() {} });
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const DELETE = handle;
export const OPTIONS = handle;
export const HEAD = handle;
