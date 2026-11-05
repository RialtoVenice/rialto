import { getRequest } from "@tanstack/react-start/server";

export const PRIMARY_ORIGIN = "https://rialto.casa";

/** The origin the visitor is using (Vercel or the Higgsfield mirror), so commands on the page point at the right host. */
export function requestOrigin(): string {
  try {
    const req = getRequest();
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    if (!host) return PRIMARY_ORIGIN;
    const proto = req.headers.get("x-forwarded-proto") ?? "https";
    return `${proto}://${host}`;
  } catch {
    return PRIMARY_ORIGIN;
  }
}
