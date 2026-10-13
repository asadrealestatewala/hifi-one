import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { MAX_SHOT_BYTES, MonitorError, storeBrowserScreenshot } from "@/lib/monitoring";
import { limiter } from "@/lib/rate-limit";
import { defaultStorage } from "@/lib/storage";

export const dynamic = "force-dynamic";
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

// One JPEG or PNG snapshot from the person's own browser screen share. Same-origin only, own session only, and the server
// applies the policy again: working hours, not on a break, clocked in, no faster than the interval.
export async function POST(req: Request) {
  const user = await requirePermission("monitoring.own");
  if (user.userType !== "EMPLOYEE") return reply({ error: "Unauthorized" }, 401);
  const origin = req.headers.get("origin");
  if (!origin || new URL(origin).host !== req.headers.get("host")) return reply({ error: "Forbidden" }, 403);
  if (!limiter("snapshot-user", 30, 3_600_000).take(user.id)) return reply({ error: "Too many snapshots." }, 429);
  const bytes = Buffer.from(await req.arrayBuffer());
  if (bytes.length > MAX_SHOT_BYTES) return reply({ error: "Too large" }, 413);
  try {
    const s = await storeBrowserScreenshot(db, defaultStorage(), { organizationId: user.organizationId, userId: user.id }, bytes);
    return reply({ id: s.id, capturedAt: s.capturedAt });
  } catch (e) {
    if (e instanceof MonitorError) return reply({ error: e.message }, 400);
    throw e;
  }
}
