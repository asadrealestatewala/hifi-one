// Live screen view. A manager with `monitoring.live_view` ASKS to watch a screen the person is already sharing in their browser.
// The person must say yes each time; they see a banner for as long as it runs; every accepted view is written to the access log
// they can read. The video itself goes browser to browser (WebRTC); the server only relays the handshake and keeps the record.
import type { PrismaClient } from "@prisma/client";
import { publishTo } from "./chat-hub";
import { getPolicy, hasAccepted, withinSchedule } from "./monitoring";

type Db = PrismaClient;
export class LiveViewError extends Error {}
export const REQUEST_SECONDS = 60;
export const liveKey = (userId: string) => `live:${userId}`;
const notify = (userId: string, event: string, data: unknown) => publishTo([liveKey(userId)], event, data);

export type Viewer = { id: string; organizationId: string; name: string; permissions: ReadonlySet<string> };

export async function requestLiveView(db: Db, viewer: Viewer, subjectId: string, now = new Date()) {
  if (!viewer.permissions.has("monitoring.live_view")) throw new LiveViewError("You do not have permission to ask for a live view.");
  if (subjectId === viewer.id) throw new LiveViewError("You cannot ask to watch yourself.");
  const subject = await db.user.findFirst({ where: { id: subjectId, organizationId: viewer.organizationId, userType: "EMPLOYEE", active: true }, select: { id: true } });
  if (!subject) throw new LiveViewError("That person was not found.");
  const policy = await getPolicy(db, viewer.organizationId);
  if (!policy.enabled || !policy.liveView) throw new LiveViewError("Live view is not switched on in the monitoring policy.");
  if (!(await hasAccepted(db, subjectId, policy.version))) throw new LiveViewError("This person has not accepted the current terms.");
  const open = await db.workSession.findFirst({ where: { userId: subjectId, endedAt: null }, include: { breaks: { where: { endedAt: null } } } });
  if (!open) throw new LiveViewError("This person is not clocked in.");
  if (open.breaks.length) throw new LiveViewError("This person is on a break.");
  if (!withinSchedule(policy, now)) throw new LiveViewError("It is outside working hours.");
  await expireOld(db, subjectId, now);
  const busy = await db.liveView.findFirst({ where: { subjectId, status: { in: ["REQUESTED", "ACCEPTED"] } } });
  if (busy) throw new LiveViewError("A live view request for this person is already open.");
  const lv = await db.liveView.create({ data: { organizationId: viewer.organizationId, viewerId: viewer.id, subjectId, createdAt: now } });
  notify(subjectId, "request", { id: lv.id, viewerName: viewer.name, seconds: REQUEST_SECONDS });
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
  if (accept) await db.monitoringAccess.create({ data: { organizationId: lv.organizationId, viewerId: lv.viewerId, subjectId: userId, what: "LIVE_VIEW", targetId: id, createdAt: now } });
  notify(lv.viewerId, "answered", { id, accepted: accept });
  return next;
}

export async function endLiveView(db: Db, userId: string, id: string, now = new Date()) {
  const lv = await db.liveView.findFirst({ where: { id, OR: [{ viewerId: userId }, { subjectId: userId }] } });
  if (!lv) throw new LiveViewError("Live view not found.");
  if (!["REQUESTED", "ACCEPTED"].includes(lv.status)) return lv;
  const next = await db.liveView.update({ where: { id }, data: { status: lv.status === "REQUESTED" ? "EXPIRED" : "ENDED", endedAt: now } });
  notify(lv.viewerId === userId ? lv.subjectId : lv.viewerId, "ended", { id });
  return next;
}

// Hands the connection handshake to the other person, only for an accepted request and only between its two people.
export async function relayLiveSignal(db: Db, userId: string, id: string, data: unknown) {
  if (JSON.stringify(data ?? null).length > 20_000) throw new LiveViewError("Message too large.");
  const lv = await db.liveView.findFirst({ where: { id, status: "ACCEPTED", OR: [{ viewerId: userId }, { subjectId: userId }] } });
  if (!lv) throw new LiveViewError("This live view is not running.");
  notify(lv.viewerId === userId ? lv.subjectId : lv.viewerId, "signal", { id, data });
}

// A clock-out, a break or a policy change ends any running view at once.
export async function endViewsFor(db: Db, subjectId: string, now = new Date()) {
  const open = await db.liveView.findMany({ where: { subjectId, status: { in: ["REQUESTED", "ACCEPTED"] } } });
  for (const lv of open) { await db.liveView.update({ where: { id: lv.id }, data: { status: "ENDED", endedAt: now } }); notify(lv.viewerId, "ended", { id: lv.id }); notify(subjectId, "ended", { id: lv.id }); }
}
