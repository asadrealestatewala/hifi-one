// Meetings and online workshops: scheduling, a shareable guest link, a waiting room the host controls, and chat.
// Rules that matter:
//  - The guest link holds a 32-character random secret. Anyone with it can ask to join, but guests wait in a lobby until the host
//    (or a staff host) admits them, unless the host switched the waiting room off.
//  - Each person joins as a "participant" with a private ticket kept in a cookie. Only admitted participants receive the call,
//    chat or roster; a waiting, denied, removed or departed person gets nothing.
//  - Only the host can admit, deny, remove people or end the meeting for everyone.
//  - An ended or cancelled meeting's link stops working.
import crypto from "node:crypto";
import type { PrismaClient } from "@prisma/client";

export class MeetingError extends Error {}
type Db = PrismaClient;
export const MAX_PEOPLE = 8; // video is peer to peer: every person sends to every other person, so quality drops beyond this
export const KINDS = ["MEETING", "WORKSHOP"] as const;
const token = () => crypto.randomBytes(16).toString("hex");

export async function createMeeting(db: Db, p: {
  organizationId: string; hostId: string; title: string; kind?: string; projectId?: string | null; clientId?: string | null; agenda?: string | null;
  scheduledAt?: string | null; durationMin?: number; waitingRoom?: boolean; purpose?: string;
}) {
  const title = p.title.trim();
  if (!title || title.length > 140) throw new MeetingError("Give the meeting a title of up to 140 characters.");
  const kind = p.kind ?? "MEETING";
  if (!(KINDS as readonly string[]).includes(kind)) throw new MeetingError("Choose meeting or workshop.");
  const purpose = p.purpose ?? "GENERAL";
  if (!["GENERAL", "TEAM", "DISCOVERY", "WEEKLY_REVIEW", "SUPPORT", "TUTORIAL", "INQUIRY"].includes(purpose)) throw new MeetingError("Choose what the meeting is for.");
  const duration = p.durationMin ?? 60;
  if (!Number.isInteger(duration) || duration < 5 || duration > 480) throw new MeetingError("Duration must be between 5 and 480 minutes.");
  let scheduledAt: Date | null = null;
  if (p.scheduledAt) { scheduledAt = new Date(p.scheduledAt); if (Number.isNaN(scheduledAt.getTime())) throw new MeetingError("Enter a valid date and time."); }
  if (p.projectId && !(await db.project.findFirst({ where: { id: p.projectId, organizationId: p.organizationId } }))) throw new MeetingError("Unknown project.");
  if (p.clientId && !(await db.client.findFirst({ where: { id: p.clientId, organizationId: p.organizationId } }))) throw new MeetingError("Unknown client.");
  return db.meeting.create({
    data: { organizationId: p.organizationId, hostId: p.hostId, title, kind, purpose, projectId: p.projectId || null, clientId: p.clientId || null, agenda: p.agenda?.trim().slice(0, 4000) || null, scheduledAt, durationMin: duration, joinToken: token(), waitingRoom: p.waitingRoom ?? true },
  });
}

const open = (m: { status: string }) => m.status === "SCHEDULED" || m.status === "LIVE";
const cleanName = (n: string) => n.replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 40);

async function activeCount(db: Db, meetingId: string) {
  return db.meetingParticipant.count({ where: { meetingId, status: "ADMITTED" } });
}

// Staff of the organization join directly (no lobby). Joining again from another tab or after a refresh reuses the same identity.
export async function joinAsStaff(db: Db, p: { meetingId: string; user: { id: string; name: string; organizationId: string } }) {
  const m = await db.meeting.findFirst({ where: { id: p.meetingId, organizationId: p.user.organizationId } });
  if (!m) throw new MeetingError("Meeting not found.");
  if (!open(m)) throw new MeetingError("This meeting has ended.");
  const existing = await db.meetingParticipant.findFirst({ where: { meetingId: m.id, userId: p.user.id, status: { in: ["ADMITTED", "WAITING"] } } });
  if (existing) return { meeting: m, participant: existing };
  if ((await activeCount(db, m.id)) >= MAX_PEOPLE) throw new MeetingError(`This meeting is full (${MAX_PEOPLE} people).`);
  const isHost = m.hostId === p.user.id;
  const participant = await db.meetingParticipant.create({ data: { meetingId: m.id, userId: p.user.id, name: cleanName(p.user.name) || "Staff", isHost, ticket: token(), status: "ADMITTED", admittedAt: new Date() } });
  if (m.status === "SCHEDULED") await db.meeting.update({ where: { id: m.id }, data: { status: "LIVE", startedAt: new Date() } });
  return { meeting: (await db.meeting.findUnique({ where: { id: m.id } }))!, participant };
}

export async function joinAsGuest(db: Db, p: { joinToken: string; name: string }) {
  if (!/^[0-9a-f]{32}$/.test(p.joinToken)) throw new MeetingError("This meeting link is not valid.");
  const m = await db.meeting.findUnique({ where: { joinToken: p.joinToken } });
  if (!m || !open(m)) throw new MeetingError("This meeting link is no longer valid.");
  const name = cleanName(p.name);
  if (name.length < 2) throw new MeetingError("Enter your name so the host knows who is joining.");
  const waiting = await db.meetingParticipant.count({ where: { meetingId: m.id, status: "WAITING" } });
  if (waiting >= 25) throw new MeetingError("Too many people are waiting. Please try again in a moment.");
  const admitNow = !m.waitingRoom;
  if (admitNow && (await activeCount(db, m.id)) >= MAX_PEOPLE) throw new MeetingError(`This meeting is full (${MAX_PEOPLE} people).`);
  const participant = await db.meetingParticipant.create({ data: { meetingId: m.id, name, ticket: token(), status: admitNow ? "ADMITTED" : "WAITING", admittedAt: admitNow ? new Date() : null } });
  if (admitNow && m.status === "SCHEDULED") await db.meeting.update({ where: { id: m.id }, data: { status: "LIVE", startedAt: new Date() } });
  return { meeting: m, participant };
}

// The room endpoints identify the caller by the ticket in their cookie, never by anything they send.
export async function authenticateParticipant(db: Db, meetingId: string, ticket: string | null | undefined) {
  if (!ticket || !/^[0-9a-f]{32}$/.test(ticket)) return null;
  const participant = await db.meetingParticipant.findFirst({ where: { meetingId, ticket }, include: { meeting: true } });
  if (!participant || ["LEFT", "REMOVED", "DENIED"].includes(participant.status)) return null;
  if (!open(participant.meeting)) return null;
  return participant;
}

const hostOf = (p: { isHost: boolean; meeting: { hostId: string }; userId: string | null }) => p.isHost || (p.userId !== null && p.userId === p.meeting.hostId);

export async function decide(db: Db, p: { meetingId: string; actorTicket: string; targetId: string; action: "ADMIT" | "DENY" | "REMOVE" }) {
  const actor = await authenticateParticipant(db, p.meetingId, p.actorTicket);
  if (!actor || actor.status !== "ADMITTED" || !hostOf(actor)) throw new MeetingError("Only the host can do that.");
  const target = await db.meetingParticipant.findFirst({ where: { id: p.targetId, meetingId: p.meetingId } });
  if (!target) throw new MeetingError("Person not found.");
  if (target.id === actor.id) throw new MeetingError("You cannot do that to yourself.");
  if (p.action === "ADMIT") {
    if (target.status !== "WAITING") throw new MeetingError("That person is not waiting.");
    if ((await activeCount(db, p.meetingId)) >= MAX_PEOPLE) throw new MeetingError(`The meeting is full (${MAX_PEOPLE} people).`);
    await db.meetingParticipant.update({ where: { id: target.id }, data: { status: "ADMITTED", admittedAt: new Date() } });
  } else if (p.action === "DENY") {
    if (target.status !== "WAITING") throw new MeetingError("That person is not waiting.");
    await db.meetingParticipant.update({ where: { id: target.id }, data: { status: "DENIED" } });
  } else {
    if (target.status !== "ADMITTED") throw new MeetingError("That person is not in the meeting.");
    await db.meetingParticipant.update({ where: { id: target.id }, data: { status: "REMOVED", leftAt: new Date() } });
  }
  return target;
}

export async function leave(db: Db, participantId: string) {
  await db.meetingParticipant.updateMany({ where: { id: participantId, status: { in: ["ADMITTED", "WAITING"] } }, data: { status: "LEFT", leftAt: new Date() } });
}

export async function endMeeting(db: Db, p: { meetingId: string; actorTicket: string }) {
  const actor = await authenticateParticipant(db, p.meetingId, p.actorTicket);
  if (!actor || !hostOf(actor)) throw new MeetingError("Only the host can end the meeting for everyone.");
  const now = new Date();
  await db.meetingParticipant.updateMany({ where: { meetingId: p.meetingId, status: { in: ["ADMITTED", "WAITING"] } }, data: { status: "LEFT", leftAt: now } });
  await db.meeting.update({ where: { id: p.meetingId }, data: { status: "ENDED", endedAt: now } });
}

export async function cancelMeeting(db: Db, p: { organizationId: string; meetingId: string; userId: string }) {
  const m = await db.meeting.findFirst({ where: { id: p.meetingId, organizationId: p.organizationId } });
  if (!m) throw new MeetingError("Meeting not found.");
  if (m.hostId !== p.userId) throw new MeetingError("Only the host can cancel a meeting.");
  if (m.status !== "SCHEDULED") throw new MeetingError("Only a meeting that has not started can be cancelled.");
  await db.meeting.update({ where: { id: m.id }, data: { status: "CANCELLED" } });
}

export async function postMessage(db: Db, p: { meetingId: string; ticket: string; body: string }) {
  const who = await authenticateParticipant(db, p.meetingId, p.ticket);
  if (!who || who.status !== "ADMITTED") throw new MeetingError("You are not in this meeting.");
  const body = p.body.replace(/\u0000/g, "").trim();
  if (!body) throw new MeetingError("Type a message first.");
  if (body.length > 1000) throw new MeetingError("Messages are limited to 1000 characters.");
  const m = await db.meetingMessage.create({ data: { meetingId: p.meetingId, participantId: who.id, authorName: who.name, body } });
  return { id: m.id, participantId: who.id, authorName: who.name, body: m.body, at: m.createdAt.toISOString() };
}

export async function history(db: Db, meetingId: string, limit = 200) {
  const rows = await db.meetingMessage.findMany({ where: { meetingId }, orderBy: { createdAt: "asc" }, take: limit });
  return rows.map((m) => ({ id: m.id, participantId: m.participantId, authorName: m.authorName, body: m.body, at: m.createdAt.toISOString() }));
}

// After the meeting: who came, when, for how long.
export async function attendance(db: Db, meetingId: string, now = new Date()) {
  const ps = await db.meetingParticipant.findMany({ where: { meetingId, admittedAt: { not: null } }, orderBy: { admittedAt: "asc" } });
  return ps.map((p) => ({ name: p.name, staff: p.userId !== null, host: p.isHost, from: p.admittedAt!, to: p.leftAt, minutes: Math.max(0, Math.round(((p.leftAt ?? now).getTime() - p.admittedAt!.getTime()) / 60000)) }));
}

// Public STUN helps two computers find each other. Across strict company firewalls a TURN relay is also needed; set ICE_SERVERS
// (a JSON array in the standard WebRTC format) to use your own.
export function iceServers(env: Record<string, string | undefined> = process.env): { urls: string | string[]; username?: string; credential?: string }[] {
  try {
    const parsed = env.ICE_SERVERS ? JSON.parse(env.ICE_SERVERS) : null;
    if (Array.isArray(parsed) && parsed.length && parsed.every((s) => s && (typeof s.urls === "string" || Array.isArray(s.urls)))) return parsed;
  } catch { /* fall through to the default */ }
  return [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }];
}

export const guestLink = (base: string, joinToken: string) => `${base.replace(/\/$/, "")}/join/${joinToken}`;
