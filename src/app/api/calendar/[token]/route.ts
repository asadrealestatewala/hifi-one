import { db } from "@/lib/db";
import { eventsForToken, renderIcs } from "@/lib/calendar";
import { limiter } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

// Calendar apps cannot sign in, so this address is protected by a 48-character random secret (see lib/calendar.ts).
// Unknown, switched-off and inactive-user tokens all look identical: a plain 404.
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token: raw } = await params;
  const token = raw.replace(/\.ics$/, "");
  const ip = (req.headers.get("x-forwarded-for") ?? "local").split(",")[0].trim();
  if (!limiter("calendar-feed", 120, 3_600_000).take(`${ip}:${token.slice(0, 8)}`)) return new Response("Too many requests", { status: 429 });
  const events = await eventsForToken(db, token);
  if (!events) return new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });
  return new Response(renderIcs(events, "Hifi One"), {
    headers: { "content-type": "text/calendar; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", "content-disposition": "inline; filename=hifi-one.ics" },
  });
}
