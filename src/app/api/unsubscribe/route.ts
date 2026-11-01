import { db } from "@/lib/db";
import { FollowUpError, unsubscribe } from "@/lib/followups";
import { limiter } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

// One-click unsubscribe (RFC 8058): mail apps POST here from the List-Unsubscribe header of follow-up emails.
// Public by design; protected by the signed token in the address, and rate limited.
export async function POST(req: Request) {
  const ip = (req.headers.get("x-forwarded-for") ?? "local").split(",")[0].trim();
  if (!limiter("unsubscribe-api", 60, 60 * 60_000).take(ip)) return new Response("Too many requests", { status: 429 });
  const token = new URL(req.url).searchParams.get("t") ?? "";
  try {
    await unsubscribe(db, token);
  } catch (e) {
    if (e instanceof FollowUpError) return new Response("Not found", { status: 404 });
    throw e;
  }
  return new Response("Unsubscribed", { status: 200 });
}
