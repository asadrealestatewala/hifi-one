import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { limiter } from "@/lib/rate-limit";
import { addonState, ingestFromAddon } from "@/lib/monitoring";

export const dynamic = "force-dynamic";
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
// A custom header makes a browser ask permission first (preflight), which no other website can get, so only the add-on can call this.
const fromAddon = (req: Request) => req.headers.get("x-hifi-addon") === "1";

export async function GET(req: Request) {
  if (!fromAddon(req)) return reply({ error: "Not allowed." }, 403);
  const user = await requirePermission("monitoring.own", { json: true });
  if (user instanceof Response) return user;
  return reply(await addonState(db, { organizationId: user.organizationId, userId: user.id }));
}

// { sites: [{ domain, seconds }] }: host names only. Anything else is dropped.
export async function POST(req: Request) {
  if (!fromAddon(req)) return reply({ error: "Not allowed." }, 403);
  const user = await requirePermission("monitoring.own", { json: true });
  if (user instanceof Response) return user;
  if (!limiter("addon-sites", 120, 3_600_000).take(user.id)) return reply({ error: "Too many reports." }, 429);
  const text = await req.text();
  if (text.length > 20_000) return reply({ error: "Too large." }, 413);
  let body: { sites?: { domain: string; seconds: number }[] };
  try { body = JSON.parse(text || "{}"); } catch { return reply({ error: "Bad request." }, 400); }
  return reply(await ingestFromAddon(db, { organizationId: user.organizationId, userId: user.id }, Array.isArray(body.sites) ? body.sites : []));
}
