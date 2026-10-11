import { db } from "@/lib/db";
import { deviceFrom, guarded, json } from "@/lib/agent-http";
import { MAX_SHOT_BYTES, storeScreenshot } from "@/lib/monitoring";
import { defaultStorage } from "@/lib/storage";

export const dynamic = "force-dynamic";

// One PNG or JPEG per request, sent as the raw body. Accepted only when the policy has screenshots on, inside working hours,
// outside breaks, and no faster than the policy interval.
export async function POST(req: Request) {
  return guarded(async () => {
    const auth = await deviceFrom(req);
    if (!auth) return json({ error: "Unauthorized" }, 401);
    const bytes = Buffer.from(await req.arrayBuffer());
    if (bytes.length > MAX_SHOT_BYTES) return json({ error: "Too large" }, 413);
    const s = await storeScreenshot(db, defaultStorage(), { organizationId: auth.user.organizationId, userId: auth.user.id, deviceId: auth.device.id }, { bytes });
    return json({ id: s.id, capturedAt: s.capturedAt });
  });
}
