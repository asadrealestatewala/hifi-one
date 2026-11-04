// Fetches a stranger's website home page from the server without letting that website (or its DNS) point us at our own network.
// Rules: http and https only, default ports only, no credentials in the address, and every address the name resolves to must be a
// public one. The check runs INSIDE the connection's name lookup, so the address that was checked is the address connected to
// (no gap for DNS rebinding), and it runs again for every redirect. Timeouts, a size cap and a content-type check bound the cost.
// Free of Next.js imports so it can be tested.
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import zlib from "node:zlib";

export class SafeFetchError extends Error { constructor(message: string, readonly code: "BAD_URL" | "BLOCKED" | "TIMEOUT" | "TOO_BIG" | "NOT_HTML" | "NETWORK" | "REDIRECTS" | "HTTP" = "NETWORK") { super(message); } }

// True only for an address on the public internet
export function isPublicIp(ip: string): boolean {
  const v = net.isIP(ip);
  if (v === 4) {
    const [a, b, c] = ip.split(".").map(Number);
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false; // this-network, private, loopback, multicast and reserved
    if (a === 100 && b >= 64 && b <= 127) return false; // carrier-grade NAT
    if (a === 169 && b === 254) return false; // link-local, including cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 192 && b === 0 && (c === 0 || c === 2)) return false;
    if (a === 198 && (b === 18 || b === 19)) return false;
    if (a === 198 && b === 51 && c === 100) return false;
    if (a === 203 && b === 0 && c === 113) return false;
    return true;
  }
  if (v === 6) {
    const x = ip.toLowerCase();
    const mapped = x.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/); // IPv4 inside IPv6
    if (mapped) return isPublicIp(mapped[1]);
    if (x === "::" || x === "::1") return false;
    if (/^f[cd]/.test(x)) return false; // unique local
    if (/^fe[89ab]/.test(x)) return false; // link-local
    if (/^ff/.test(x)) return false; // multicast
    if (/^(64:ff9b|2001:db8|2001:10|2001:2|100:)/.test(x)) return false; // translation, documentation, benchmarking, discard
    return true;
  }
  return false;
}

export function parsePublicUrl(raw: string, allowAnyPort = false): URL {
  let u: URL;
  try { u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`); } catch { throw new SafeFetchError("That is not a web address.", "BAD_URL"); }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new SafeFetchError("Only http and https addresses are checked.", "BAD_URL");
  if (u.username || u.password) throw new SafeFetchError("Addresses with a login in them are not checked.", "BAD_URL");
  if (!allowAnyPort && u.port && !((u.protocol === "http:" && u.port === "80") || (u.protocol === "https:" && u.port === "443"))) throw new SafeFetchError("Addresses on unusual ports are not checked.", "BAD_URL");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || (!net.isIP(host) && !host.includes("."))) throw new SafeFetchError("That address is not a public website.", "BLOCKED");
  return u;
}

type Resolve = (host: string) => Promise<{ address: string; family: number }[]>;
const systemResolve: Resolve = (host) => dns.promises.lookup(host, { all: true, verbatim: true });

export type FetchedPage = { finalUrl: string; status: number; html: string; truncated: boolean; redirects: number };
// `allowAnyPort` exists only so tests can reach a local server on a random port; nothing in the application sets it
export type FetchOptions = { allowAnyPort?: boolean; timeoutMs?: number; maxBytes?: number; maxRedirects?: number; resolve?: Resolve; isAllowedIp?: (ip: string) => boolean };

const UA = "HifiOneProspector/1.0 (+https://hifimarketing.co)";

export async function fetchPublicPage(raw: string, opts: FetchOptions = {}): Promise<FetchedPage> {
  const timeoutMs = opts.timeoutMs ?? 10_000, maxBytes = opts.maxBytes ?? 1_500_000, maxRedirects = opts.maxRedirects ?? 4;
  const resolve = opts.resolve ?? systemResolve, allowed = opts.isAllowedIp ?? isPublicIp;
  const deadline = Date.now() + timeoutMs;
  let url = parsePublicUrl(raw, opts.allowAnyPort);
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const left = deadline - Date.now();
    if (left <= 0) throw new SafeFetchError("The website took too long to answer.", "TIMEOUT");
    const r = await once(url, { left, maxBytes, resolve, allowed });
    if (r.redirectTo) {
      if (hop === maxRedirects) throw new SafeFetchError("The website redirects too many times.", "REDIRECTS");
      url = parsePublicUrl(new URL(r.redirectTo, url).toString(), opts.allowAnyPort);
      continue;
    }
    return { finalUrl: url.toString(), status: r.status, html: r.html, truncated: r.truncated, redirects: hop };
  }
  throw new SafeFetchError("The website redirects too many times.", "REDIRECTS");
}

type Once = { status: number; html: string; truncated: boolean; redirectTo?: string };
function once(url: URL, o: { left: number; maxBytes: number; resolve: Resolve; allowed: (ip: string) => boolean }): Promise<Once> {
  return new Promise((resolvePromise, reject) => {
    const mod = url.protocol === "https:" ? https : http;
    // Node does not call the name lookup for an address written as numbers, so those are checked here, before any connection
    const literal = url.hostname.replace(/^\[|\]$/g, "");
    if (net.isIP(literal) && !o.allowed(literal)) return reject(new SafeFetchError("That address is not a public website.", "BLOCKED"));
    let settled = false;
    const fail = (e: SafeFetchError) => { if (!settled) { settled = true; reject(e); } };
    const done = (v: Once) => { if (!settled) { settled = true; resolvePromise(v); } };
    // The guard: resolve the name, refuse unless EVERY answer is public, and hand the connection one of those exact addresses
    const lookup = ((hostname: string, options: { all?: boolean }, cb: (...a: unknown[]) => void) => {
      const host = hostname.replace(/^\[|\]$/g, "");
      const answers = net.isIP(host) ? Promise.resolve([{ address: host, family: net.isIP(host) }]) : o.resolve(host);
      answers.then((list) => {
        if (list.length === 0 || !list.every((a) => o.allowed(a.address))) return cb(new SafeFetchError("That address is not a public website.", "BLOCKED"));
        if (options?.all) return cb(null, list);
        cb(null, list[0].address, list[0].family);
      }, () => cb(new SafeFetchError("The website's address could not be found.", "NETWORK")));
    }) as unknown as typeof dns.lookup;
    const req = mod.request(url, {
      method: "GET", lookup, timeout: Math.min(o.left, 10_000), agent: false,
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1", "Accept-Encoding": "gzip, deflate, br", "Accept-Language": "en" },
    }, (res) => {
      const status = res.statusCode ?? 0;
      const loc = res.headers.location;
      if (status >= 300 && status < 400 && loc) { res.resume(); return done({ status, html: "", truncated: false, redirectTo: loc }); }
      const type = String(res.headers["content-type"] ?? "");
      if (status >= 200 && status < 300 && type && !/html|xml|text\/plain/i.test(type)) { res.resume(); return fail(new SafeFetchError("The address is not a web page.", "NOT_HTML")); }
      const enc = String(res.headers["content-encoding"] ?? "").toLowerCase();
      let stream: NodeJS.ReadableStream = res;
      // Decompress with a hard limit on the decompressed size, so a tiny compressed file cannot expand without bound
      const limit = { maxOutputLength: o.maxBytes };
      if (enc === "gzip" || enc === "x-gzip") stream = res.pipe(zlib.createGunzip(limit));
      else if (enc === "deflate") stream = res.pipe(zlib.createInflate(limit));
      else if (enc === "br") stream = res.pipe(zlib.createBrotliDecompress(limit));
      else if (enc && enc !== "identity") { res.resume(); return fail(new SafeFetchError("The website sent a format we cannot read.", "NOT_HTML")); }
      const chunks: Buffer[] = []; let size = 0, truncated = false;
      stream.on("data", (c: Buffer) => {
        if (truncated) return;
        size += c.length;
        if (size > o.maxBytes) { truncated = true; chunks.push(c.subarray(0, c.length - (size - o.maxBytes))); res.destroy(); stream.removeAllListeners("data"); done({ status, html: Buffer.concat(chunks).toString("utf8"), truncated: true }); return; }
        chunks.push(c);
      });
      stream.on("end", () => done({ status, html: Buffer.concat(chunks).toString("utf8"), truncated }));
      stream.on("error", () => { if (truncated || chunks.length) done({ status, html: Buffer.concat(chunks).toString("utf8"), truncated: true }); else fail(new SafeFetchError("The page could not be read.", "NETWORK")); });
    });
    req.on("timeout", () => { req.destroy(); fail(new SafeFetchError("The website took too long to answer.", "TIMEOUT")); });
    req.on("error", (e) => fail(e instanceof SafeFetchError ? e : (e as { cause?: unknown }).cause instanceof SafeFetchError ? (e as { cause: SafeFetchError }).cause : /BLOCKED|not a public/.test(String(e.message)) ? new SafeFetchError("That address is not a public website.", "BLOCKED") : new SafeFetchError("The website could not be reached.", "NETWORK")));
    req.end();
  });
}
