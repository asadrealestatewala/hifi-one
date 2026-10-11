import { db } from "@/lib/db";
import { deviceFrom, guarded, json } from "@/lib/agent-http";
import { agentPolicy } from "@/lib/monitoring";

export const dynamic = "force-dynamic";

// What this device may collect right now. The agent obeys it; every upload is checked against the same rules again.
export async function GET(req: Request) {
  return guarded(async () => {
    const auth = await deviceFrom(req);
    if (!auth) return json({ error: "Unauthorized" }, 401);
    return json(await agentPolicy(db, { organizationId: auth.user.organizationId, userId: auth.user.id }));
  });
}
