// Live screen view. A manager with `monitoring.live_view` ASKS to watch a screen the person is already sharing in their browser.
// The person must say yes each time; they see a banner for as long as it runs; every accepted view is written to the access log
// they can read. The video itself goes browser to browser (WebRTC); the server only relays the handshake and keeps the record.
import type { PrismaClient } from "@prisma/client";
import { isOnline, publishTo } from "./chat-hub";
import { getPolicy, hasAccepted, withinSchedule } from "./monitoring";

type Db = PrismaClient;
export class LiveViewError extends Error {}
export const REQUEST_SECONDS = 60;
export const liveKey = (userId: string) => `live:${userId}`;
const notify = (userId: string, event: string, data: unknown) => publishTo([liveKey(userId)], event, data);

export type Viewer = { id: string; organizationId: string; name: string; permissions: ReadonlySet<string> };

export type RequestKind = "VIEW" | "SUPPORT";

export async function requestLiveView(db: Db, viewer: Viewer, subjectId: string, now = new Date(), opts: { kind?: RequestKind; reason?: string } = {}) {
  const kind: RequestKind = opts.kind ?? "VIEW";
  const reason = (opts.reason ?? "").trim().slice(0, 300);
  const perm = kind === "SUPPORT" ? "monitoring.remote_support" : "monitoring.live_view";
  if (!viewer.permissions.has(perm)) throw new LiveViewError(kind === "SUPPORT" ? "You do not have permission to ask for remote support." : "You do not have permission to ask for a live view.");
  if (subjectId === viewer.id) throw new LiveViewError("You cannot ask to watch yourself.");
  if (kind === "SUPPORT" && reason.length < 5) throw new LiveViewError("Say why you want to help, so the person knows before they answer.");
  const subject = await db.user.findFirst({ where: { id: subjectId, organizationId: viewer.organizationId, userType: "EMPLOYEE", active: true }, select: { id: true } });
  if (!subject) throw new LiveViewError("That person was not found.");
  const policy = await getPolicy(db, viewer.organizationId);
  if (!policy.enabled || !(kind === "SUPPORT" ? policy.remoteSupport : policy.liveView)) throw new LiveViewError(kind === "SUPPORT" ? "Remote support is not switched on in the monitoring policy." : "Live view is not switched on in the monitoring policy.");
  if (!(await hasAccepted(db, subjectId, policy.version))) throw new LiveViewError("This person has not accepted the current terms.");
  if (kind === "VIEW") {
    const open = await db.workSession.findFirst({ where: { userId: subjectId, endedAt: null }, include: { breaks: { where: { endedAt: null } } } });
    if (!open) throw new LiveViewError("This person is not clocked in.");
    if (open.breaks.length) throw new LiveViewError("This person is on a break.");
    if (!withinSchedule(policy, now)) throw new LiveViewError("It is outside working hours.");
  } else if (!isOnline(liveKey(subjectId))) {
    // Support is asked for by the person's own need, so it may happen outside the tracked day, but only while they are here to answer.
    throw new LiveViewError("This person is not signed in to Hifi One right now.");
  }
  await expireOld(db, subjectId, now);
  const busy = await db.liveView.findFirst({ where: { subjectId, status: { in: ["REQUESTED", "ACCEPTED"] } } });
  if (busy) throw new LiveViewError("A live view request for this person is already open.");
  const lv = await db.liveView.create({ data: { organizationId: viewer.organizationId, viewerId: viewer.id, subjectId, kind, reason: kind === "SUPPORT" ? reason : null, createdAt: now } });
  notify(subjectId, "request", { id: lv.id, viewerName: viewer.name, seconds: REQUEST_SECONDS, kind, reason: lv.reason });
  return lv;
}

async function expireOld(db: Db, subjectId: string, now: Date) {
  await db.liveView.updateMany({ where: { subjectId, status: "REQUESTED", createdAt: { lt: new Date(now.getTime() - REQUEST_SECONDS * 1000) } }, data: { status: "EXPIRED", endedAt: now } });
}

export async function respondLiveView(db: Db, userId: string, id: string, accept: boolean, now = new Date()) {
  await expireOld(db, userId, now);
  const lv = await db.liveView.findFirst({ where: { id, subjectId: userId } });
  if (!lv || lv.status !== "REQUESTED") throw new LiveViewError("This request is no longer open.");
  const next = await db.liveView.update({ where: { id }, data: accept ? { status: "ACCEPTED", answeredAt: now } : { status: "DECLINED", answeredAt: now, endedAt: now } });
  // The record the person can read: written when they agree, so a view that never started is never logged as one.
  if (accept) await db.monitoringAccess.create({ data: { organizationId: lv.organizationId, viewerId: lv.viewerId, subjectId: userId, what: lv.kind === "SUPPORT" ? "REMOTE_SUPPORT" : "LIVE_VIEW", targetId: id, createdAt: now } });
  notify(lv.viewerId, "answered", { id, accepted: accept });
  return next;
}

export async function endLiveView(db: Db, userId: string, id: string, now = new Date()) {
  const lv = await db.liveView.findFirst({ where: { id, OR: [{ viewerId: userId }, { subjectId: userId }] } });
  if (!lv) throw new LiveViewError("Live view not found.");
  if (!["REQUESTED", "ACCEPTED"].includes(lv.status)) return lv;
  const next = await db.liveView.update({ where: { id }, data: { status: lv.status === "REQUESTED" ? "EXPIRED" : "ENDED", endedAt: now } });
  qs().delete(id);
  notify(lv.viewerId === userId ? lv.subjectId : lv.viewerId, "ended", { id });
  return next;
}

// Hands the connection handshake to the other person, only for an accepted request and only between its two people.
// A phone cannot hold the browser event stream, so handshake messages for a phone wait in a short queue it reads by polling.
type Q = { seq: number; items: { seq: number; data: unknown }[] };
const qs = () => ((globalThis as unknown as { __phoneQ?: Map<string, Q> }).__phoneQ ??= new Map<string, Q>());

export async function relayLiveSignal(db: Db, userId: string, id: string, data: unknown) {
  if (JSON.stringify(data ?? null).length > 20_000) throw new LiveViewError("Message too large.");
  const lv = await db.liveView.findFirst({ where: { id, status: "ACCEPTED", OR: [{ viewerId: userId }, { subjectId: userId }] } });
  if (!lv) throw new LiveViewError("This live view is not running.");
  if (lv.deviceId && lv.viewerId === userId) {
    const q = qs().get(id) ?? { seq: 0, items: [] };
    q.items.push({ seq: ++q.seq, data });
    if (q.items.length > 200) q.items.shift();
    qs().set(id, q);
    return;
  }
  notify(lv.viewerId === userId ? lv.subjectId : lv.viewerId, "signal", { id, data });
}

export async function phoneSignals(db: Db, userId: string, id: string, after: number) {
  const lv = await db.liveView.findFirst({ where: { id, subjectId: userId, deviceId: { not: null } } });
  if (!lv) throw new LiveViewError("Request not found.");
  const q = qs().get(id);
  return { status: lv.status, signals: (q?.items ?? []).filter((i) => i.seq > after) };
}

// A clock-out, a break or a policy change ends any running view at once.
export async function endViewsFor(db: Db, subjectId: string, now = new Date()) {
  const open = await db.liveView.findMany({ where: { subjectId, kind: "VIEW", status: { in: ["REQUESTED", "ACCEPTED"] } } });
  for (const lv of open) { await db.liveView.update({ where: { id: lv.id }, data: { status: "ENDED", endedAt: now } }); notify(lv.viewerId, "ended", { id: lv.id }); notify(subjectId, "ended", { id: lv.id }); }
}

// ---------- company phones ----------
// Only phones an administrator has marked company-owned can be offered support, and only for the person who signed in on them.
export async function markPhone(db: Db, p: { organizationId: string; deviceId: string; companyOwned: boolean; label?: string }) {
  const d = await db.pushDevice.findFirst({ where: { id: p.deviceId, user: { organizationId: p.organizationId } } });
  if (!d) throw new LiveViewError("Phone not found.");
  return db.pushDevice.update({ where: { id: d.id }, data: { companyOwned: p.companyOwned, label: p.label?.trim().slice(0, 60) || d.label } });
}

export async function requestPhoneSupport(db: Db, viewer: Viewer, deviceId: string, reason: string, now = new Date()) {
  if (!viewer.permissions.has("monitoring.remote_support")) throw new LiveViewError("You do not have permission to ask for remote support.");
  const device = await db.pushDevice.findFirst({ where: { id: deviceId, user: { organizationId: viewer.organizationId, userType: "EMPLOYEE", active: true } } });
  if (!device) throw new LiveViewError("Phone not found.");
  if (!device.companyOwned) throw new LiveViewError("Remote support is only offered on company-owned phones.");
  if (device.userId === viewer.id) throw new LiveViewError("You cannot ask to watch yourself.");
  if (reason.trim().length < 5) throw new LiveViewError("Say why you want to help, so the person knows before they answer.");
  const policy = await getPolicy(db, viewer.organizationId);
  if (!policy.enabled || !policy.remoteSupport) throw new LiveViewError("Remote support is not switched on in the monitoring policy.");
  if (!(await hasAccepted(db, device.userId, policy.version))) throw new LiveViewError("This person has not accepted the current terms.");
  await expireOld(db, device.userId, now);
  if (await db.liveView.findFirst({ where: { subjectId: device.userId, status: { in: ["REQUESTED", "ACCEPTED"] } } })) throw new LiveViewError("A request for this person is already open.");
  return db.liveView.create({ data: { organizationId: viewer.organizationId, viewerId: viewer.id, subjectId: device.userId, deviceId: device.id, kind: "SUPPORT", reason: reason.trim().slice(0, 300), createdAt: now } });
}

// What the person's phone should show: the terms to accept (if any) and the request waiting for an answer (if any).
export async function phoneSupportState(db: Db, user: { id: string; organizationId: string }, now = new Date()) {
  const policy = await getPolicy(db, user.organizationId);
  const on = policy.enabled && policy.remoteSupport;
  const accepted = on && (await hasAccepted(db, user.id, policy.version));
  await expireOld(db, user.id, now);
  const req = on && accepted ? await db.liveView.findFirst({ where: { subjectId: user.id, deviceId: { not: null }, status: { in: ["REQUESTED", "ACCEPTED"] } }, orderBy: { createdAt: "desc" } }) : null;
  const helper = req ? await db.user.findUnique({ where: { id: req.viewerId }, select: { name: true } }) : null;
  return {
    enabled: on,
    needsTerms: on && !accepted,
    terms: on && !accepted ? { version: policy.version, text: policy.policyText, remoteSupport: true } : null,
    request: req ? { id: req.id, status: req.status, helper: helper?.name ?? "Someone", reason: req.reason, expiresInSeconds: req.status === "REQUESTED" ? Math.max(0, REQUEST_SECONDS - Math.round((now.getTime() - req.createdAt.getTime()) / 1000)) : null } : null,
  };
}
