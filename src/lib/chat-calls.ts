// One-to-one voice and video calls started from a direct chat. A call is an instant meeting room (the existing WebRTC room with
// its signalling and ICE_SERVERS) whose purpose is CALL, plus a CALL message in the conversation that records how it went:
// ringing, answered, declined, missed or ended with a duration. The callee is rung over the live chat stream.
// Free of Next.js imports so it can be tested against the database.
import crypto from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { ChatError, type ChatActor, type ChatMessageDto, memberIds } from "./chat";
import { joinAsStaff, MeetingError } from "./meetings";

export const RING_SECONDS = 45;
export type CallMode = "audio" | "video";
export type CallState = { meetingId: string; mode: CallMode; status: "RINGING" | "ANSWERED" | "DECLINED" | "MISSED" | "ENDED"; answeredAt?: string; durationSec?: number };

export const parseCall = (body: string): CallState | null => {
  try {
    const c = JSON.parse(body) as CallState;
    return c && typeof c.meetingId === "string" && ["audio", "video"].includes(c.mode) ? c : null;
  } catch { return null; }
};

async function callMember(db: PrismaClient, actor: ChatActor, roomId: string) {
  const m = await db.chatMember.findFirst({ where: { roomId, userId: actor.id, leftAt: null, room: { organizationId: actor.organizationId } }, include: { room: true } });
  if (!m) throw new ChatError("Conversation not found.");
  return m;
}

const dto = (m: { id: string; roomId: string; senderId: string | null; kind: string; body: string; createdAt: Date }, senderName: string | null): ChatMessageDto => ({
  id: m.id, roomId: m.roomId, senderId: m.senderId, senderName, kind: m.kind, body: m.body, createdAt: m.createdAt.toISOString(), deleted: false, attachments: [],
});

async function loadCall(db: PrismaClient, actor: ChatActor, messageId: string) {
  const msg = await db.chatMessage.findFirst({ where: { id: messageId, kind: "CALL", room: { organizationId: actor.organizationId } } });
  if (!msg) throw new ChatError("Call not found.");
  await callMember(db, actor, msg.roomId);
  const call = parseCall(msg.body);
  if (!call) throw new ChatError("Call not found.");
  return { msg, call };
}

async function setState(db: PrismaClient, msgId: string, call: CallState) {
  const m = await db.chatMessage.update({ where: { id: msgId }, data: { body: JSON.stringify(call) } });
  const sender = m.senderId ? (await db.user.findUnique({ where: { id: m.senderId }, select: { name: true } }))?.name ?? null : null;
  return { message: dto(m, sender), recipients: await memberIds(db, m.roomId) };
}

const endMeetingRow = (db: PrismaClient, meetingId: string) =>
  db.meeting.updateMany({ where: { id: meetingId, status: { in: ["SCHEDULED", "LIVE"] } }, data: { status: "ENDED", endedAt: new Date() } });

export async function startCall(db: PrismaClient, actor: ChatActor, roomId: string, mode: string) {
  if (mode !== "audio" && mode !== "video") throw new ChatError("Choose a voice or video call.");
  const m = await callMember(db, actor, roomId);
  if (m.room.kind !== "DIRECT") throw new ChatError("Calls work in direct conversations for now.");
  await sweepStaleCalls(db, roomId);
  const other = await db.chatMember.findFirst({ where: { roomId, userId: { not: actor.id }, leftAt: null } });
  const callee = other ? await db.user.findFirst({ where: { id: other.userId, organizationId: actor.organizationId, active: true, userType: "EMPLOYEE" }, select: { id: true, name: true } }) : null;
  if (!callee) throw new ChatError("That person is not available for calls.");
  const live = await db.chatMessage.findMany({ where: { roomId, kind: "CALL", createdAt: { gt: new Date(Date.now() - 12 * 3600_000) } }, orderBy: { createdAt: "desc" }, take: 5 });
  if (live.some((x) => { const c = parseCall(x.body); return c && (c.status === "RINGING" || c.status === "ANSWERED"); })) throw new ChatError("There is already a call in this conversation.");
  const meeting = await db.meeting.create({
    data: { organizationId: actor.organizationId, hostId: actor.id, title: `${mode === "video" ? "Video" : "Voice"} call: ${actor.name} and ${callee.name}`, kind: "MEETING", purpose: "CALL", durationMin: 60, joinToken: crypto.randomBytes(16).toString("hex"), waitingRoom: true }, // staff join directly; the guest link of a call room is never shown, and strangers would wait in the lobby anyway
  });
  let ticket: string;
  try { ticket = (await joinAsStaff(db, { meetingId: meeting.id, user: actor })).participant.ticket; } catch (e) { throw e instanceof MeetingError ? new ChatError(e.message) : e; }
  const call: CallState = { meetingId: meeting.id, mode, status: "RINGING" };
  const msg = await db.chatMessage.create({ data: { roomId, senderId: actor.id, kind: "CALL", body: JSON.stringify(call) } });
  await db.chatRoom.update({ where: { id: roomId }, data: { lastMessageAt: msg.createdAt } });
  await db.chatMember.update({ where: { roomId_userId: { roomId, userId: actor.id } }, data: { lastReadAt: msg.createdAt } });
  return { message: dto(msg, actor.name), recipients: [actor.id, callee.id], calleeId: callee.id, meetingId: meeting.id, ticket, call };
}

export async function answerCall(db: PrismaClient, actor: ChatActor, messageId: string) {
  const { msg, call } = await loadCall(db, actor, messageId);
  if (msg.senderId === actor.id) throw new ChatError("You started this call.");
  if (call.status !== "RINGING") throw new ChatError("This call is no longer ringing.");
  if (Date.now() - msg.createdAt.getTime() > (RING_SECONDS + 10) * 1000) { await expireCall(db, messageId); throw new ChatError("This call is no longer ringing."); }
  let ticket: string;
  try { ticket = (await joinAsStaff(db, { meetingId: call.meetingId, user: actor })).participant.ticket; } catch (e) { throw e instanceof MeetingError ? new ChatError(e.message) : e; }
  const out = await setState(db, msg.id, { ...call, status: "ANSWERED", answeredAt: new Date().toISOString() });
  return { ...out, meetingId: call.meetingId, mode: call.mode, ticket };
}

export async function declineCall(db: PrismaClient, actor: ChatActor, messageId: string) {
  const { msg, call } = await loadCall(db, actor, messageId);
  if (msg.senderId === actor.id) throw new ChatError("You started this call.");
  if (call.status !== "RINGING") throw new ChatError("This call is no longer ringing.");
  await endMeetingRow(db, call.meetingId);
  return setState(db, msg.id, { ...call, status: "DECLINED" });
}

// The caller hangs up before anyone answers
export async function cancelCall(db: PrismaClient, actor: ChatActor, messageId: string) {
  const { msg, call } = await loadCall(db, actor, messageId);
  if (msg.senderId !== actor.id) throw new ChatError("Only the caller can cancel.");
  if (call.status !== "RINGING") throw new ChatError("This call is no longer ringing.");
  await endMeetingRow(db, call.meetingId);
  return setState(db, msg.id, { ...call, status: "MISSED" });
}

// Nobody answered in time (also run when the server restarts mid-ring, see sweepStaleCalls)
export async function expireCall(db: PrismaClient, messageId: string) {
  const msg = await db.chatMessage.findFirst({ where: { id: messageId, kind: "CALL" } });
  const call = msg ? parseCall(msg.body) : null;
  if (!msg || !call || call.status !== "RINGING") return null;
  await endMeetingRow(db, call.meetingId);
  return setState(db, msg.id, { ...call, status: "MISSED" });
}

export async function sweepStaleCalls(db: PrismaClient, roomId: string) {
  const stale = await db.chatMessage.findMany({ where: { roomId, kind: "CALL", createdAt: { lt: new Date(Date.now() - (RING_SECONDS + 15) * 1000), gt: new Date(Date.now() - 24 * 3600_000) } } });
  for (const m of stale) if (parseCall(m.body)?.status === "RINGING") await expireCall(db, m.id);
}

// Called whenever someone leaves a meeting room. When nobody is left in a call room the call is over:
// ended with its length if it was answered, missed if the caller gave up while it rang.
export async function afterLeave(db: PrismaClient, meetingId: string) {
  const meeting = await db.meeting.findUnique({ where: { id: meetingId } });
  if (!meeting || meeting.purpose !== "CALL") return null;
  if ((await db.meetingParticipant.count({ where: { meetingId, status: "ADMITTED" } })) > 0) return null;
  await endMeetingRow(db, meetingId);
  const msg = await db.chatMessage.findFirst({ where: { kind: "CALL", body: { contains: meetingId } } });
  const call = msg ? parseCall(msg.body) : null;
  if (!msg || !call) return null;
  if (call.status === "RINGING") return setState(db, msg.id, { ...call, status: "MISSED" });
  if (call.status === "ANSWERED") return setState(db, msg.id, { ...call, status: "ENDED", durationSec: Math.max(1, Math.round((Date.now() - new Date(call.answeredAt ?? msg.createdAt).getTime()) / 1000)) });
  return null;
}
