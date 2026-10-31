// Fetches every /site page from a running server, then every same-origin asset the pages and their CSS reference.
// Usage: node scripts/site/check.mjs http://localhost:3000 src/app/site/_html
import fs from "node:fs";
import path from "node:path";

const [BASE, HTML_DIR] = process.argv.slice(2);
const routes = fs.readdirSync(HTML_DIR).map((f) => f.replace(/\.html$/, "")).map((n) =>
  n === "index" ? "/site" : n === "jobs" ? "/site/careers/jobs" : n.startsWith("job-") ? `/site/careers/jobs/${n.slice(4)}` : n.startsWith("blog-") ? `/site/blog/${n.slice(5)}` : `/site/${n}`);
const seen = new Map();
const bad = [];
async function check(u, from) {
  if (seen.has(u)) return seen.get(u);
  const p = fetch(new URL(u, BASE)).then(async (r) => {
    const type = r.headers.get("content-type") || "";
    const body = type.includes("css") || type.includes("html") ? await r.text() : (await r.arrayBuffer(), "");
    if (r.status !== 200) bad.push([r.status, u, from]);
    return { status: r.status, type, body, csp: r.headers.get("content-security-policy") };
  });
  seen.set(u, p);
  return p;
}
const refsOf = (text) => [
  ...[...text.matchAll(/\b(?:src|href|poster)\s*=\s*["']([^"']+)["']/g)].map((m) => m[1]),
  ...[...text.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)].map((m) => m[1]),
  ...[...text.matchAll(/["'](\/site\/[^"']+\.(?:png|jpe?g|webp|avif|gif|svg|mov|mp4))["']/g)].map((m) => m[1]),
].filter((r) => r.startsWith("/") && !r.startsWith("//"));

for (const route of routes) {
  const page = await check(route, "-");
  console.log(page.status, route, page.type, page.csp ? "csp" : "no-csp");
  for (const ref of refsOf(page.body)) {
    const a = await check(ref.split("#")[0], route);
    if (a.type.includes("css")) for (const r2 of refsOf(a.body)) await check(new URL(r2, new URL(ref, BASE)).pathname, ref);
  }
}
console.log(`checked ${seen.size} urls, ${bad.length} not 200`);
for (const b of bad) console.log("BAD", ...b);
