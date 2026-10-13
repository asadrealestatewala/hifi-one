import { getSessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { dockState } from "@/lib/monitoring";

export const dynamic = "force-dynamic";

// What the Workfolio dock may do for the signed-in person right now. Only their own state; nothing about anyone else.
export async function GET() {
  const user = await getSessionUser();
  if (!user || user.userType !== "EMPLOYEE" || !user.permissions.has("monitoring.own")) return new Response(JSON.stringify({ available: false, reason: null, hidden: true }), { status: 200, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  const s = await dockState(db, { organizationId: user.organizationId, userId: user.id });
  return new Response(JSON.stringify(s), { headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
