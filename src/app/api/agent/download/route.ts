import { audit, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { createEnrollmentCode, getPolicy, MonitorError } from "@/lib/monitoring";
import { limiter } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

// Where the Windows program is hosted. Set AGENT_DOWNLOAD_URL on the server to move it; the default is the GitHub release the
// "Desktop app" workflow publishes.
const downloadUrl = () => process.env.AGENT_DOWNLOAD_URL?.trim() || "https://github.com/asadrealestatewala/hifi-one/releases/latest/download/HifiOneAgent.exe";

const plain = (message: string, status: number) => new Response(message, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });

// "One button" download for the signed-in employee. Pressing it creates a one-time code for that person alone (valid one hour, single
// use) and names the file after it, so running the file connects this computer without typing anything. POST only: it creates
// something, and the sign-in cookie is not sent on cross-site POSTs.
export async function POST() {
  const user = await requirePermission("monitoring.own"); // redirects to sign-in or "forbidden"
  if (user.userType !== "EMPLOYEE") return plain("Only staff accounts can use the desktop app.", 403);
  if (!limiter("agent-download", 5, 600_000).take(user.id)) return plain("Too many downloads. Wait a few minutes.", 429);
  const policy = await getPolicy(db, user.organizationId);
  if (!policy.enabled) return plain("Time and activity tracking is not switched on yet, so there is nothing to connect.", 409);
  // Check the file exists before spending a code on it
  const file = await fetch(downloadUrl(), { redirect: "follow", signal: AbortSignal.timeout(30_000) }).catch(() => null);
  if (!file || !file.ok || !file.body) return plain("The desktop app file is not published yet. Ask your administrator.", 503);
  let code: string;
  try {
    code = await createEnrollmentCode(db, { organizationId: user.organizationId, userId: user.id, createdById: user.id });
  } catch (e) {
    await file.body.cancel().catch(() => {});
    if (e instanceof MonitorError) return plain(e.message, 400);
    throw e;
  }
  await audit(user, { action: "monitoring.agent_download", entity: "User", entityId: user.id });
  const headers = new Headers({ "content-type": "application/octet-stream", "content-disposition": `attachment; filename="HifiOneAgent-${code}.exe"`, "cache-control": "no-store" });
  const length = file.headers.get("content-length");
  if (length) headers.set("content-length", length);
  return new Response(file.body, { headers });
}
