// Whether a browser request came from a page on this same site. Browsers send Origin with every fetch POST; it must name the
// host the request was sent to (behind a proxy, the forwarded host). The scheme is not compared because TLS usually ends at
// the proxy. A request without Origin (a non-browser client) is allowed: rate limits and validation still apply to it.
export function sameSite(req: { headers: { get(name: string): string | null } }): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  let host: string;
  try { host = new URL(origin).host.toLowerCase(); } catch { return false; }
  const target = (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "").split(",")[0].trim().toLowerCase();
  return target !== "" && host === target;
}
