import { audit } from "@/lib/auth";
import { db } from "@/lib/db";
import { LiveViewError, endLiveView, phoneSignals, phoneSupportState, relayLiveSignal, respondLiveView } from "@/lib/live-view";
import { acknowledge, getPolicy } from "@/lib/monitoring";
import { iceServers } from "@/lib/meetings";
import { isResponse, json, readJson, requireMobileUser, str } from "@/lib/mobile-api";

export const dynamic = "force-dynamic";

// The phone asks: are there terms I must accept, and is someone waiting for my answer?
export async function GET(req: Request) {
  const a = await requireMobileUser(req, "monitoring.own");
  if (isResponse(a)) return a;
  const url = new URL(req.url);
  const sid = url.searchParams.get("signals");
  if (sid) {
    try { return json(await phoneSignals(db, a.user.id, sid, Number(url.searchParams.get("after") ?? 0) || 0)); }
    catch (e) { if (e instanceof LiveViewError) return json({ error: e.message }, 409); throw e; }
  }
  return json({ ...(await phoneSupportState(db, a.user)), iceServers: iceServers() });
}

// { op: "accept_terms", version } | { op: "respond", id, accept } | { op: "signal", id, data } | { op: "end", id }
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
    } else if (op === "signal") {
      await relayLiveSignal(db, user.id, str(b.id, 60), b.data);
      return json({ ok: true });
    } else if (op === "end") {
      await endLiveView(db, user.id, str(b.id, 60));
    } else return json({ error: "Unknown request." }, 400);
  } catch (e) {
    if (e instanceof LiveViewError) return json({ error: e.message }, 409);
    throw e;
  }
  return json(await phoneSupportState(db, user));
}
