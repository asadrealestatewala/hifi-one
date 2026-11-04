import { describe, expect, it } from "vitest";
import http from "node:http";
import { gzipSync } from "node:zlib";
import { SafeFetchError, fetchPublicPage, isPublicIp, parsePublicUrl } from "./safe-fetch";

describe("which addresses count as public", () => {
  it("refuses private, loopback, link-local, metadata, CGNAT and reserved IPv4", () => {
    for (const ip of ["127.0.0.1", "10.0.0.5", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255", "198.18.0.1"]) expect(isPublicIp(ip), ip).toBe(false);
  });
  it("refuses private IPv6 and IPv4 hidden inside IPv6", () => {
    for (const ip of ["::1", "::", "fe80::1", "fc00::1", "fd12:3456::1", "ff02::1", "::ffff:127.0.0.1", "::ffff:10.1.2.3", "2001:db8::1"]) expect(isPublicIp(ip), ip).toBe(false);
  });
  it("accepts ordinary public addresses and refuses what is not an address", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "93.184.216.34", "2606:4700:4700::1111", "::ffff:8.8.8.8"]) expect(isPublicIp(ip), ip).toBe(true);
    expect(isPublicIp("not-an-ip")).toBe(false);
    expect(isPublicIp("")).toBe(false);
  });
});

describe("which web addresses are accepted", () => {
  it("adds https to a bare domain and keeps http and https", () => {
    expect(parsePublicUrl("example.com").toString()).toBe("https://example.com/");
    expect(parsePublicUrl("http://example.com/a").protocol).toBe("http:");
  });
  it("refuses other schemes, logins, odd ports, local names and bare words", () => {
    for (const u of ["ftp://example.com", "file:///etc/passwd", "javascript:alert(1)", "https://user:pw@example.com", "https://example.com:8080", "http://localhost", "https://intranet", "http://printer.local", "http://svc.internal", "http://a.localhost"]) expect(() => parsePublicUrl(u), u).toThrow(SafeFetchError);
  });
  it("refuses a literal private IP in the address", async () => {
    await expect(fetchPublicPage("http://127.0.0.1/")).rejects.toMatchObject({ code: "BLOCKED" });
    await expect(fetchPublicPage("http://169.254.169.254/latest/meta-data")).rejects.toMatchObject({ code: "BLOCKED" });
    await expect(fetchPublicPage("http://[::1]/")).rejects.toMatchObject({ code: "BLOCKED" });
  });
  it("refuses a name that resolves to a private address, even if one of several answers is public (rebinding)", async () => {
    await expect(fetchPublicPage("https://evil.example", { resolve: async () => [{ address: "127.0.0.1", family: 4 }] })).rejects.toMatchObject({ code: "BLOCKED" });
    await expect(fetchPublicPage("https://evil.example", { resolve: async () => [{ address: "8.8.8.8", family: 4 }, { address: "10.0.0.1", family: 4 }] })).rejects.toMatchObject({ code: "BLOCKED" });
  });
});

// A real local server stands in for a website; the address check is told to allow it and the port rule is relaxed, which no application path can do
describe("reading a page", () => {
  const open = (handler: http.RequestListener) => new Promise<{ url: string; close: () => void }>((resolve) => {
    const s = http.createServer(handler).listen(0, "127.0.0.1", () => resolve({ url: `http://127.0.0.1:${(s.address() as { port: number }).port}`, close: () => s.close() }));
  });
  const go = (url: string, opts: Parameters<typeof fetchPublicPage>[1] = {}) => fetchPublicPage(url, { allowAnyPort: true, isAllowedIp: () => true, ...opts });

  it("reads a page, follows a redirect and reports where it ended", async () => {
    const s = await open((req, res) => { if (req.url === "/") { res.writeHead(301, { Location: "/home" }); res.end(); } else { res.writeHead(200, { "content-type": "text/html" }); res.end("<title>Hi</title>"); } });
    const r = await go(s.url); s.close();
    expect(r.html).toContain("<title>Hi</title>"); expect(r.finalUrl.endsWith("/home")).toBe(true); expect(r.redirects).toBe(1);
  });
  it("stops at the size cap, and cannot be blown up by compression", async () => {
    const big = "<p>" + "a".repeat(200_000) + "</p>";
    const s = await open((_q, res) => { res.writeHead(200, { "content-type": "text/html" }); res.end(big); });
    const r = await go(s.url, { maxBytes: 50_000 }); s.close();
    expect(r.truncated).toBe(true); expect(r.html.length).toBeLessThanOrEqual(50_000);
    const z = await open((_q, res) => { res.writeHead(200, { "content-type": "text/html", "content-encoding": "gzip" }); res.end(gzipSync(Buffer.from("x".repeat(5_000_000)))); });
    const r2 = await go(z.url, { maxBytes: 100_000 }); z.close();
    expect(r2.html.length).toBeLessThanOrEqual(100_000);
  });
  it("refuses non-pages, endless redirects and slow sites", async () => {
    const pdf = await open((_q, res) => { res.writeHead(200, { "content-type": "application/pdf" }); res.end("x"); });
    await expect(go(pdf.url)).rejects.toMatchObject({ code: "NOT_HTML" }); pdf.close();
    const loop = await open((_q, res) => { res.writeHead(302, { Location: "/again" }); res.end(); });
    await expect(go(loop.url, { maxRedirects: 3 })).rejects.toMatchObject({ code: "REDIRECTS" }); loop.close();
    const slow = await open(() => { /* never answers */ });
    await expect(go(slow.url, { timeoutMs: 400 })).rejects.toMatchObject({ code: "TIMEOUT" }); slow.close();
  });
  it("refuses a redirect to a private address even when the first hop was fine", async () => {
    const s = await open((_q, res) => { res.writeHead(302, { Location: "http://169.254.169.254/latest/meta-data/" }); res.end(); });
    // The first hop (our local server) is allowed for the test only; the redirect target must still be refused by the same guard
    await expect(go(s.url, { isAllowedIp: (ip: string) => ip === "127.0.0.1" })).rejects.toMatchObject({ code: "BLOCKED" }); s.close();
  });
});

