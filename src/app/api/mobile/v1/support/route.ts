import { audit } from "@/lib/auth";
import { db } from "@/lib/db";
import { LiveViewError, endLiveView, phoneSupportState, respondLiveView } from "@/lib/live-view";
import { acknowledge, getPolicy } from "@/lib/monitoring";
import { isResponse, json, readJson, requireMobileUser, str } from "@/lib/mobile-api";

export const dynamic = "force-dynamic";

// The phone asks: are there terms I must accept, and is someone waiting for my answer?
export async function GET(req: Request) {
  const a = await requireMobileUser(req, "monitoring.own");
  if (isResponse(a)) return a;
  return json(await phoneSupportState(db, a.user));
}

// { op: "accept_terms", version } | { op: "respond", id, accept } | { op: "end", id }
export async function POST(req: Request) {
  const a = await requireMobileUser(req, "monitoring.own");
  if (isResponse(a)) return a;
  const { user } = a;
  const b = await readJson(req);
  const op = str(b.op, 20);
  try {
    if (op === "accept_terms") {
      const policy = await getPolicy(db, user.organizationId);
      if (Number(b.version) !== policy.version) return json({ error: "The terms changed. Please read the new version." }, 409);
      await acknowledge(db, { userId: user.id, version: policy.version });
      await audit(user, { action: "monitoring.accept_policy", entity: "MonitoringPolicy", after: { version: policy.version, via: "mobile" } });
    } else if (op === "respond") {
      await respondLiveView(db, user.id, str(b.id, 60), b.accept === true);
    } else if (op === "end") {
      await endLiveView(db, user.id, str(b.id, 60));
    } else return json({ error: "Unknown request." }, 400);
  } catch (e) {
    if (e instanceof LiveViewError) return json({ error: e.message }, 409);
    throw e;
  }
  return json(await phoneSupportState(db, user));
}
