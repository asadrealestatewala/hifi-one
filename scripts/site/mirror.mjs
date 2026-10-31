// Mirrors hifimarketing.co pages and every asset they reference into <out>, rewriting refs to /site/... paths.
// Usage: node scripts/site/mirror.mjs <outDir outside the repo>, then scripts/site/install.mjs (see docs/SYSTEM_MAP.md, Public website)
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const OUT = path.resolve(process.argv[2]);
const RAW = path.join(OUT, "raw");
const PUB = path.join(OUT, "public", "site");
const HTML_OUT = path.join(OUT, "html");
for (const d of [RAW, PUB, HTML_OUT]) fs.mkdirSync(d, { recursive: true });

const ORIGIN = "https://hifimarketing.co/";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const HEAD = { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" };

// page name -> [source url, served route]
const PAGES = {
  index: ["index.php", "/site"],
  services: ["services.php", "/site/services"],
  about: ["about.php", "/site/about"],
  team: ["team.php", "/site/team"],
  pricing: ["pricing.php", "/site/pricing"],
  careers: ["careers.php", "/site/careers"],
  blog: ["blog.php", "/site/blog"],
  contact: ["contact.php", "/site/contact"],
  "blog-5": ["blog.php?id=5", "/site/blog/5"],
  jobs: ["job.php", "/site/careers/jobs"],
};
// Job detail pages are listed on job.php; each becomes a snapshot under /site/careers/jobs/<id>
const jobList = await (await fetch(ORIGIN + "job.php", { headers: { ...HEAD, Accept: "text/html" } })).text();
for (const id of new Set([...jobList.matchAll(/job-detail\.php\?id=(\d+)/g)].map((m) => m[1]))) PAGES[`job-${id}`] = [`job-detail.php?id=${id}`, `/site/careers/jobs/${id}`];
const ROUTE_OF = Object.fromEntries(Object.values(PAGES).map(([src, route]) => [src, route]));
ROUTE_OF["login.php"] = "/login";
ROUTE_OF["client-portal/login.php"] = "/portal";
ROUTE_OF[""] = "/site";

const log = { ok: [], failed: [], external: new Set() };
const done = new Map(); // absolute url -> local public url (or null when failed)

async function get(url, accept = "*/*") {
  const res = await fetch(url, { headers: { ...HEAD, Accept: accept }, redirect: "follow" });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return { buf: Buffer.from(await res.arrayBuffer()), type: res.headers.get("content-type") || "" };
}

const EXT = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/avif": ".avif" };

// Where an absolute asset url lives under public/site
function localPath(u, type) {
  const url = new URL(u);
  if (url.hostname === "hifimarketing.co" || url.hostname === "www.hifimarketing.co") return decodeURIComponent(url.pathname).replace(/^\/+/, "");
  if (url.hostname === "images.unsplash.com") {
    const w = url.searchParams.get("w") || "x", h = url.searchParams.get("h") || "x";
    return `vendor/unsplash/${url.pathname.slice(1)}-${w}x${h}${EXT[type.split(";")[0]] || ".jpg"}`;
  }
  if (url.hostname === "cdnjs.cloudflare.com") return "vendor/" + url.pathname.replace(/^\/ajax\/libs\//, "");
  if (url.hostname === "fonts.googleapis.com") return `vendor/google-fonts/css-${crypto.createHash("sha1").update(u).digest("hex").slice(0, 8)}.css`;
  if (url.hostname === "fonts.gstatic.com") return "vendor/google-fonts" + url.pathname;
  return null;
}
const toPublicUrl = (p) => "/site/" + p.split("/").map(encodeURIComponent).join("/");

async function asset(abs) {
  abs = abs.split("#")[0];
  if (done.has(abs)) return done.get(abs);
  done.set(abs, null);
  try {
    const isFontCss = abs.startsWith("https://fonts.googleapis.com/");
    const { buf, type } = await get(abs, isFontCss ? "text/css,*/*;q=0.1" : "*/*");
    const rel = localPath(abs, type);
    if (!rel) throw new Error("no local mapping");
    let body = buf;
    if (rel.endsWith(".css") || type.startsWith("text/css")) body = Buffer.from(await rewriteCss(buf.toString("utf8"), abs));
    const file = path.join(PUB, ...rel.split("/"));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
    const pub = toPublicUrl(rel);
    done.set(abs, pub);
    log.ok.push([abs, pub, body.length]);
    return pub;
  } catch (e) {
    log.failed.push([abs, String(e.message || e)]);
    return null;
  }
}

async function rewriteCss(css, base) {
  const refs = new Set();
  for (const m of css.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)) refs.add(m[2]);
  for (const m of css.matchAll(/@import\s+(['"])([^'"]+)\1/g)) refs.add(m[2]);
  for (const r of refs) {
    if (r.startsWith("data:")) continue;
    const abs = new URL(r, base).href;
    const pub = await asset(abs);
    if (pub) {
      const suffix = r.includes("#") ? r.slice(r.indexOf("#")) : r.includes("?") && !abs.includes("fonts.googleapis") ? "" : "";
      css = css.split(r).join(pub + suffix);
    }
  }
  return css;
}

// Rewrite one in-page reference; returns the replacement or null to leave it alone
async function rewriteRef(ref, pageUrl) {
  const raw = ref.trim();
  if (!raw || /^(mailto:|tel:|data:|javascript:|#)/.test(raw)) return null;
  const abs = new URL(raw, pageUrl);
  const own = abs.hostname === "hifimarketing.co" || abs.hostname === "www.hifimarketing.co";
  if (own) {
    const p = abs.pathname.replace(/^\/+/, "");
    const key = p.endsWith(".php") || p === "" ? p + (abs.search && /^(blog|job-detail)\.php$/.test(p) ? abs.search : "") : null;
    if (key !== null) {
      // Applicant accounts and job applications live on the PHP site; the ERP has no applicant sign-in
      if (p === "register.php" || (p === "login.php" && abs.search)) return abs.href.replace("www.", "");
      const route = ROUTE_OF[key];
      if (route) return route + abs.hash;
      log.failed.push([abs.href, "page link without a route"]);
      return null;
    }
    return asset(abs.href).then((u) => (u ? u + abs.hash : null));
  }
  if (["images.unsplash.com", "cdnjs.cloudflare.com", "fonts.googleapis.com", "fonts.gstatic.com"].includes(abs.hostname)) return asset(abs.href);
  if (/^(fonts\.gstatic\.com)$/.test(abs.hostname)) return null;
  log.external.add(abs.origin + abs.pathname);
  return null;
}

async function processPage(name, src, route) {
  const pageUrl = new URL(src, ORIGIN).href;
  const { buf } = await get(pageUrl, "text/html,application/xhtml+xml");
  let html = buf.toString("utf8");
  fs.writeFileSync(path.join(RAW, name + ".html"), html);
  // Base for relative refs: the original page location (all pages sit at the site root)
  const refs = new Map(); // exact original token -> replacement
  const attr = /\b(src|href|poster|srcset|data-[\w-]+)\s*=\s*(["'])(.*?)\2/gis;
  for (const m of html.matchAll(attr)) {
    if (/^data-/i.test(m[1]) && !/\.(png|jpe?g|webp|avif|gif|svg|mp4|mov|webm)(\?|$)|unsplash/i.test(m[3])) continue;
    const vals = m[1].toLowerCase() === "srcset" ? m[3].split(",").map((s) => s.trim().split(/\s+/)[0]) : [m[3]];
    for (const v of vals) if (!refs.has(v)) refs.set(v, await rewriteRef(v, pageUrl));
  }
  for (const m of html.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)) if (!refs.has(m[2])) refs.set(m[2], await rewriteRef(m[2], pageUrl));
  // Image paths inside inline scripts (hover previews and similar)
  for (const m of html.matchAll(/(["'])((?:\.\/)?(?:images|uploads)\/[^"']+|https:\/\/images\.unsplash\.com\/[^"']+)\1/g)) if (!refs.has(m[2])) refs.set(m[2], await rewriteRef(m[2], pageUrl));
  // Replace inside quotes/parens only, longest first, so "images/a.jpg" never clips "images/a.jpg.webp"
  const keys = [...refs.keys()].filter((k) => refs.get(k)).sort((a, b) => b.length - a.length);
  for (const k of keys) {
    const esc = k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    html = html.replace(new RegExp(`(["'(=,\\s])${esc}(?=["')\\s,])`, "g"), (_, pre) => pre + refs.get(k));
  }
  fs.writeFileSync(path.join(HTML_OUT, name + ".html"), html);
  console.log(`page ${name} -> ${route} (${html.length} chars, ${keys.length} refs rewritten)`);
}

for (const [name, [src, route]] of Object.entries(PAGES)) {
  try { await processPage(name, src, route); } catch (e) { log.failed.push([src, String(e.message || e)]); console.log(`page ${name} FAILED ${e.message}`); }
}
// Shared files linked from pages that the site also serves
for (const extra of ["css/style.css", "js/main.js", "images/fav-icon.png"]) await asset(new URL(extra, ORIGIN).href);

fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify({ ok: log.ok, failed: log.failed, external: [...log.external].sort() }, null, 2));
const total = log.ok.reduce((s, x) => s + x[2], 0);
console.log(`assets ${log.ok.length}, ${(total / 1048576).toFixed(2)} MB; failed ${log.failed.length}; external links ${log.external.size}`);
for (const f of log.failed) console.log("FAILED", ...f);
