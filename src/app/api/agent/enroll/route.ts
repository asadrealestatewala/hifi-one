import { db } from "@/lib/db";
import { guarded, json } from "@/lib/agent-http";
import { agentPolicy, enrollDevice, MonitorError } from "@/lib/monitoring";
import { limiter } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

// The desktop agent trades a one-time code, created for one named person by an administrator, for a device token.
// The code is single-use and expires in an hour; attempts are rate limited per address.
export async function POST(req: Request) {
  return guarded(async () => {
    const ip = (req.headers.get("x-forwarded-for") ?? "local").split(",")[0].trim();
    if (!limiter("agent-enroll", 10, 600_000).take(ip)) throw new MonitorError("Too many attempts. Wait a few minutes.");
    const b = (await req.json().catch(() => ({}))) as { code?: string; name?: string; os?: string; version?: string };
    const { token, device } = await enrollDevice(db, { code: String(b.code ?? ""), name: String(b.name ?? "Computer"), os: b.os, version: b.version });
    return json({ token, policy: await agentPolicy(db, { organizationId: device.organizationId, userId: device.userId }) });
  });
}
