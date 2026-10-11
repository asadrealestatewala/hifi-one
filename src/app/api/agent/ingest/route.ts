import { db } from "@/lib/db";
import { deviceFrom, guarded, json } from "@/lib/agent-http";
import { ingestAgent } from "@/lib/monitoring";

export const dynamic = "force-dynamic";

// Aggregate activity and application durations only. Anything outside the policy, the working hours or the figures a
// computer could plausibly report in the time is dropped and counted, never stored.
export async function POST(req: Request) {
  return guarded(async () => {
    const auth = await deviceFrom(req);
    if (!auth) return json({ error: "Unauthorized" }, 401);
    const text = await req.text();
    if (text.length > 200_000) return json({ error: "Too large" }, 413);
    const body = JSON.parse(text || "{}") as { buckets?: { start: string; active: number; idle: number; keys?: number; clicks?: number }[]; apps?: { name: string; seconds: number }[] };
    return json(await ingestAgent(db, { organizationId: auth.user.organizationId, userId: auth.user.id }, { buckets: body.buckets, apps: body.apps }));
  });
}
