import fs from "node:fs";
import path from "node:path";

// The public website is a snapshot of hifimarketing.co. Each page is served as its original HTML document,
// outside the ERP layout, so the site's own markup, styles and scripts run unchanged. Assets live in public/site.
const HTML_DIR = path.join(process.cwd(), "src", "app", "site", "_html");

export function sitePageNames(): string[] {
  return fs.readdirSync(HTML_DIR).filter((f) => f.endsWith(".html")).map((f) => f.slice(0, -5));
}

export function sitePage(name: string, extraHeaders: Record<string, string> = {}): Response {
  if (!/^[a-z0-9-]+$/.test(name) || !sitePageNames().includes(name)) return new Response("Not found", { status: 404 });
  const html = fs.readFileSync(path.join(HTML_DIR, `${name}.html`), "utf8");
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", ...extraHeaders } });
}
