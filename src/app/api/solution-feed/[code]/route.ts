import { db } from "@/lib/db";
import { FeedError, ingestReport } from "@/lib/solution-feed";
import { limiter } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const MAX_BODY = 2_000_000;

// A Solution posts its signed report here: headers X-Feed-Timestamp (milliseconds) and X-Feed-Signature (hex HMAC-SHA256 of
// "<timestamp>.<raw body>" with the Solution's secret). Counts and status only; wrong signatures are rate limited.
export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  const ip = (req.headers.get("x-forwarded-for") ?? "local").split(",")[0].trim();
  const body = await req.text();
  if (body.length > MAX_BODY) return reply({ error: "Report too large" }, 413);
  try {
    const r = await ingestReport(db, { productCode: code, body, timestamp: req.headers.get("x-feed-timestamp") ?? "", signature: req.headers.get("x-feed-signature") ?? "" });
    return reply({ ok: true, ...r });
  } catch (e) {
    if (e instanceof FeedError) {
      if (e.status === 401 && !limiter("feed-bad", 20, 600_000).take(ip)) return reply({ error: "Too many attempts" }, 429);
      return reply({ error: e.message }, e.status);
    }
    throw e;
  }
}
