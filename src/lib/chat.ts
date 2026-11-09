// Team chat rules: rooms (direct, group, project), membership, messages with optional picture, and read state.
// Free of Next.js imports so it can be tested against the database. Every function takes the acting person and checks
// membership itself: a person who is not in a room cannot read it, send to it or learn that it exists.
import type { PrismaClient } from "@prisma/client";
import type { FileActor } from "./file-access";
import { saveFile } from "./files";
import { FileError, validateUpload } from "./file-validation";
import type { StorageProvider } from "./storage";

export class ChatError extends Error {}

export const MAX_BODY = 4000;
export const MAX_GROUP_MEMBERS = 200;
export const MAX_ATTACHMENT = 50 * 1024 * 1024; // pictures, videos, voice notes and documents sent in chat
export const kindOf = (contentType: string) => (contentType.startsWith("image/") ? "IMAGE" : contentType.startsWith("video/") ? "VIDEO" : contentType.startsWith("audio/") ? "AUDIO" : "FILE");

export type ChatActor = { id: string; organizationId: string; name: string };
export type ChatMessageDto = {
  id: string; roomId: string; senderId: string | null; senderName: string | null; kind: string; body: string; createdAt: string; deleted: boolean;
  attachments: { id: string; filename: string; contentType: string; size: number }[];
};
export type ChatRoomDto = {
  id: string; kind: string; name: string; // name is the other person for a direct room
  directUserId: string | null; projectId: string | null; members: { id: string; name: string; role: string }[];
  unread: number; lastMessageAt: string; lastMessage: { body: string; kind: string; senderName: string | null; deleted: boolean } | null; muted: boolean; isAdmin: boolean;
};

const clean = (s: unknown, max: number) => String(s ?? "").replace(/\r\n/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim().slice(0, max);

async function activeStaff(db: PrismaClient, organizationId: string, ids: string[]) {
  return db.user.findMany({ where: { id: { in: ids }, organizationId, active: true, userType: "EMPLOYEE" }, select: { id: true, name: true } });
}

// The row proving this person is currently in the room, or a refusal that looks like "no such room".
async function membership(db: PrismaClient, actor: ChatActor, roomId: string) {
  const m = await db.chatMember.findFirst({ where: { roomId, userId: actor.id, leftAt: null, room: { organizationId: actor.organizationId } }, include: { room: true } });
  if (!m) throw new ChatError("Conversation not found.");
  return m;
}

export const memberIds = async (db: PrismaClient, roomId: string) =>
  (await db.chatMember.findMany({ where: { roomId, leftAt: null }, select: { userId: true } })).map((m) => m.userId);

export async function openDirect(db: PrismaClient, actor: ChatActor, otherId: string) {
  if (otherId === actor.id) throw new ChatError("Pick a colleague to message.");
  const [other] = await activeStaff(db, actor.organizationId, [otherId]);
  if (!other) throw new ChatError("That person is not available for chat.");
  const directKey = [actor.id, otherId].sort().join(":");
  let room = await db.chatRoom.findUnique({ where: { organizationId_directKey: { organizationId: actor.organizationId, directKey } } });
  if (!room) {
    try {
      room = await db.chatRoom.create({ data: { organizationId: actor.organizationId, kind: "DIRECT", directKey, createdById: actor.id, members: { create: [{ userId: actor.id }, { userId: otherId }] } } });
    } catch { // two people opened the same pair at once; the unique key keeps one room
      room = await db.chatRoom.findUnique({ where: { organizationId_directKey: { organizationId: actor.organizationId, directKey } } });
      if (!room) throw new ChatError("Could not open the conversation. Try again.");
    }
  }
  // Someone who earlier left (a direct room cannot be left, but a deactivated person may be back) is put back in
  await db.chatMember.updateMany({ where: { roomId: room.id, userId: { in: [actor.id, otherId] }, leftAt: { not: null } }, data: { leftAt: null } });
  return room;
}

export async function createGroup(db: PrismaClient, actor: ChatActor, p: { name: string; memberIds: string[] }) {
  const name = clean(p.name, 80);
  if (name.length < 2) throw new ChatError("Give the group a name of at least 2 characters.");
  const ids = [...new Set(p.memberIds.filter((i) => i !== actor.id))];
  if (ids.length === 0) throw new ChatError("Add at least one other person.");
  if (ids.length + 1 > MAX_GROUP_MEMBERS) throw new ChatError(`A group can have up to ${MAX_GROUP_MEMBERS} people.`);
  const found = await activeStaff(db, actor.organizationId, ids);
  if (found.length !== ids.length) throw new ChatError("Some of the people you picked are not available for chat.");
  const room = await db.chatRoom.create({
    data: { organizationId: actor.organizationId, kind: "GROUP", name, createdById: actor.id, members: { create: [{ userId: actor.id, role: "ADMIN" }, ...ids.map((userId) => ({ userId }))] } },
  });
  await systemMessage(db, room.id, `${actor.name} created the group "${name}".`);
  return room;
}

async function groupAdmin(db: PrismaClient, actor: ChatActor, roomId: string) {
  const m = await membership(db, actor, roomId);
  if (m.room.kind !== "GROUP") throw new ChatError("Members of direct and project conversations are managed automatically.");
  if (m.role !== "ADMIN") throw new ChatError("Only a group admin can do that.");
  return m;
}

export async function addMembers(db: PrismaClient, actor: ChatActor, roomId: string, userIds: string[]) {
  await groupAdmin(db, actor, roomId);
  const ids = [...new Set(userIds)];
  const found = await activeStaff(db, actor.organizationId, ids);
  if (found.length !== ids.length || ids.length === 0) throw new ChatError("Some of the people you picked are not available for chat.");
  const current = await memberIds(db, roomId);
  const fresh = found.filter((u) => !current.includes(u.id));
  if (current.length + fresh.length > MAX_GROUP_MEMBERS) throw new ChatError(`A group can have up to ${MAX_GROUP_MEMBERS} people.`);
  for (const u of fresh) {
    await db.chatMember.upsert({ where: { roomId_userId: { roomId, userId: u.id } }, create: { roomId, userId: u.id }, update: { leftAt: null, role: "MEMBER", lastReadAt: new Date() } });
  }
  if (fresh.length) await systemMessage(db, roomId, `${actor.name} added ${fresh.map((u) => u.name).join(", ")}.`);
  return fresh.map((u) => u.id);
}

// An admin removes someone, or a person leaves. A group always keeps at least one admin.
export async function removeMember(db: PrismaClient, actor: ChatActor, roomId: string, userId: string) {
  const self = userId === actor.id;
  const m = self ? await membership(db, actor, roomId) : await groupAdmin(db, actor, roomId);
  if (m.room.kind !== "GROUP") throw new ChatError(self ? "You cannot leave a direct or project conversation." : "Members of direct and project conversations are managed automatically.");
  const target = await db.chatMember.findFirst({ where: { roomId, userId, leftAt: null } });
  if (!target) throw new ChatError("That person is not in the group.");
  if (target.role === "ADMIN") {
    const admins = await db.chatMember.count({ where: { roomId, role: "ADMIN", leftAt: null } });
    if (admins <= 1) {
      const heir = await db.chatMember.findFirst({ where: { roomId, leftAt: null, userId: { not: userId } }, orderBy: { joinedAt: "asc" } });
      if (!heir) throw new ChatError("You are the last person in this group.");
      await db.chatMember.update({ where: { roomId_userId: { roomId, userId: heir.userId } }, data: { role: "ADMIN" } });
    }
  }
  await db.chatMember.update({ where: { roomId_userId: { roomId, userId } }, data: { leftAt: new Date() } });
  const who = await db.user.findUnique({ where: { id: userId }, select: { name: true } });
  await systemMessage(db, roomId, self ? `${actor.name} left.` : `${actor.name} removed ${who?.name ?? "a member"}.`);
}

export async function renameGroup(db: PrismaClient, actor: ChatActor, roomId: string, name: string) {
  await groupAdmin(db, actor, roomId);
  const n = clean(name, 80);
  if (n.length < 2) throw new ChatError("Give the group a name of at least 2 characters.");
  await db.chatRoom.update({ where: { id: roomId }, data: { name: n } });
  await systemMessage(db, roomId, `${actor.name} renamed the group to "${n}".`);
}

export async function setMuted(db: PrismaClient, actor: ChatActor, roomId: string, muted: boolean) {
  await membership(db, actor, roomId);
  await db.chatMember.update({ where: { roomId_userId: { roomId, userId: actor.id } }, data: { muted } });
}

async function systemMessage(db: PrismaClient, roomId: string, body: string) {
  const m = await db.chatMessage.create({ data: { roomId, senderId: null, kind: "SYSTEM", body } });
  await db.chatRoom.update({ where: { id: roomId }, data: { lastMessageAt: m.createdAt } });
  return m;
}

// Every project has a room with its manager and members. Called when someone opens chat, so rooms appear without any admin step,
// and people who leave a project stop seeing its room.
export async function syncProjectRooms(db: PrismaClient, actor: ChatActor) {
  const projects = await db.project.findMany({
    where: { organizationId: actor.organizationId, status: { not: "CANCELLED" }, OR: [{ managerId: actor.id }, { members: { some: { userId: actor.id } } }] },
    select: { id: true, name: true, number: true, managerId: true, members: { select: { userId: true } } },
  });
  for (const p of projects) {
    const want = [...new Set([p.managerId, ...p.members.map((m) => m.userId)])];
    const room = await db.chatRoom.upsert({
      where: { projectId: p.id },
      create: { organizationId: actor.organizationId, kind: "PROJECT", projectId: p.id, name: `${p.number} ${p.name}`.trim(), createdById: p.managerId },
      update: { name: `${p.number} ${p.name}`.trim() },
    });
    const active = await activeStaff(db, actor.organizationId, want);
    for (const u of active) {
      await db.chatMember.upsert({ where: { roomId_userId: { roomId: room.id, userId: u.id } }, create: { roomId: room.id, userId: u.id, role: u.id === p.managerId ? "ADMIN" : "MEMBER" }, update: {} });
    }
  }
  // Project rooms the person is in but no longer belongs to
  const mine = await db.chatMember.findMany({ where: { userId: actor.id, leftAt: null, room: { kind: "PROJECT", organizationId: actor.organizationId } }, select: { roomId: true, room: { select: { projectId: true } } } });
  const keep = new Set(projects.map((p) => p.id));
  const gone = mine.filter((m) => m.room.projectId && !keep.has(m.room.projectId)).map((m) => m.roomId);
  if (gone.length) await db.chatMember.updateMany({ where: { userId: actor.id, roomId: { in: gone } }, data: { leftAt: new Date() } });
}

export async function listRooms(db: PrismaClient, actor: ChatActor): Promise<ChatRoomDto[]> {
  const mine = await db.chatMember.findMany({
    where: { userId: actor.id, leftAt: null, room: { organizationId: actor.organizationId } },
    include: { room: { include: { members: { where: { leftAt: null } } } } },
    orderBy: { room: { lastMessageAt: "desc" } },
    take: 300,
  });
  const userIds = [...new Set(mine.flatMap((m) => m.room.members.map((x) => x.userId)))];
  const names = new Map((await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  return Promise.all(mine.map(async (m) => {
    const [unread, last] = await Promise.all([
      db.chatMessage.count({ where: { roomId: m.roomId, createdAt: { gt: m.lastReadAt }, deletedAt: null, kind: { not: "SYSTEM" }, senderId: { not: actor.id } } }),
      db.chatMessage.findFirst({ where: { roomId: m.roomId }, orderBy: { createdAt: "desc" } }),
    ]);
    const others = m.room.members.filter((x) => x.userId !== actor.id);
    const direct = m.room.kind === "DIRECT" ? others[0]?.userId ?? null : null;
    return {
      id: m.roomId, kind: m.room.kind,
      name: m.room.kind === "DIRECT" ? (direct ? names.get(direct) ?? "Colleague" : "Colleague") : m.room.name ?? "Group",
      directUserId: direct, projectId: m.room.projectId,
      members: m.room.members.map((x) => ({ id: x.userId, name: names.get(x.userId) ?? "Colleague", role: x.role })),
      unread, lastMessageAt: m.room.lastMessageAt.toISOString(), muted: m.muted, isAdmin: m.role === "ADMIN",
      lastMessage: last ? { body: last.deletedAt ? "" : last.body, kind: last.kind, deleted: !!last.deletedAt, senderName: last.senderId ? names.get(last.senderId) ?? null : null } : null,
    };
  }));
}

async function toDtos(db: PrismaClient, rows: { id: string; roomId: string; senderId: string | null; kind: string; body: string; createdAt: Date; deletedAt: Date | null }[]): Promise<ChatMessageDto[]> {
  const senders = [...new Set(rows.map((r) => r.senderId).filter((x): x is string => !!x))];
  const names = new Map((await db.user.findMany({ where: { id: { in: senders } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const files = rows.length ? await db.storedFile.findMany({ where: { ownerType: "CHAT_MESSAGE", ownerId: { in: rows.map((r) => r.id) }, deletedAt: null }, select: { id: true, ownerId: true, filename: true, contentType: true, size: true } }) : [];
  return rows.map((r) => ({
    id: r.id, roomId: r.roomId, senderId: r.senderId, senderName: r.senderId ? names.get(r.senderId) ?? "Former colleague" : null, kind: r.kind,
    body: r.deletedAt ? "" : r.body, createdAt: r.createdAt.toISOString(), deleted: !!r.deletedAt,
    attachments: r.deletedAt ? [] : files.filter((f) => f.ownerId === r.id).map((f) => ({ id: f.id, filename: f.filename, contentType: f.contentType, size: f.size })),
  }));
}

// Newest `limit` messages (oldest first), or the page before `before`. Also returns when each other member last read, for the read ticks.
export async function history(db: PrismaClient, actor: ChatActor, roomId: string, opts: { before?: Date; limit?: number } = {}) {
  await membership(db, actor, roomId);
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);
  const rows = await db.chatMessage.findMany({ where: { roomId, ...(opts.before ? { createdAt: { lt: opts.before } } : {}) }, orderBy: { createdAt: "desc" }, take: limit + 1 });
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit).reverse();
  const reads = await db.chatMember.findMany({ where: { roomId, leftAt: null, userId: { not: actor.id } }, select: { userId: true, lastReadAt: true } });
  return { messages: await toDtos(db, page), hasMore, reads: reads.map((r) => ({ userId: r.userId, at: r.lastReadAt.toISOString() })) };
}

export async function sendMessage(
  db: PrismaClient, storage: StorageProvider, actor: ChatActor, fileActor: FileActor,
  roomId: string, p: { body?: string; attachment?: { name: string; bytes: Buffer } },
) {
  await membership(db, actor, roomId);
  const body = clean(p.body, MAX_BODY);
  if (!body && !p.attachment) throw new ChatError("Write a message or attach a file.");
  let kind = "TEXT";
  if (p.attachment) {
    try { kind = kindOf(validateUpload(p.attachment.name, p.attachment.bytes, { media: true, maxBytes: MAX_ATTACHMENT }).contentType); } catch (e) { throw e instanceof FileError ? new ChatError(e.message) : e; }
  }
  const msg = await db.chatMessage.create({ data: { roomId, senderId: actor.id, kind, body } });
  if (p.attachment) {
    try {
      await saveFile(db, storage, { actor: fileActor, ownerType: "CHAT_MESSAGE", ownerId: msg.id, name: p.attachment.name, bytes: p.attachment.bytes, media: true, maxBytes: MAX_ATTACHMENT });
    } catch (e) {
      await db.chatMessage.delete({ where: { id: msg.id } }); // no empty attachment message is left behind
      throw e instanceof FileError ? new ChatError(e.message) : e;
    }
  }
  await db.chatRoom.update({ where: { id: roomId }, data: { lastMessageAt: msg.createdAt } });
  await db.chatMember.update({ where: { roomId_userId: { roomId, userId: actor.id } }, data: { lastReadAt: msg.createdAt } }); // your own message is read
  const [dto] = await toDtos(db, [msg]);
  return { message: dto, recipients: await memberIds(db, roomId) };
}

export async function deleteMessage(db: PrismaClient, actor: ChatActor, messageId: string) {
  const msg = await db.chatMessage.findFirst({ where: { id: messageId, room: { organizationId: actor.organizationId } } });
  if (!msg || msg.senderId !== actor.id || msg.deletedAt) throw new ChatError("Message not found.");
  await membership(db, actor, msg.roomId);
  await db.chatMessage.update({ where: { id: messageId }, data: { deletedAt: new Date() } });
  await db.storedFile.updateMany({ where: { ownerType: "CHAT_MESSAGE", ownerId: messageId, deletedAt: null }, data: { deletedAt: new Date(), deletedById: actor.id } });
  return { roomId: msg.roomId, recipients: await memberIds(db, msg.roomId) };
}

export async function markRead(db: PrismaClient, actor: ChatActor, roomId: string) {
  await membership(db, actor, roomId);
  const at = new Date();
  await db.chatMember.update({ where: { roomId_userId: { roomId, userId: actor.id } }, data: { lastReadAt: at } });
  return { at: at.toISOString(), recipients: await memberIds(db, roomId) };
}

export const totalUnread = async (db: PrismaClient, userId: string): Promise<number> => {
  const rows = await db.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(*)::bigint AS n FROM "ChatMessage" m
    JOIN "ChatMember" cm ON cm."roomId" = m."roomId" AND cm."userId" = ${userId} AND cm."leftAt" IS NULL AND cm."muted" = false
    WHERE m."createdAt" > cm."lastReadAt" AND m."deletedAt" IS NULL AND m."kind" <> 'SYSTEM' AND m."senderId" <> ${userId}`;
  return Number(rows[0]?.n ?? 0);
};

// People you can start a chat with: active staff of your organization, matched by name.
export async function searchPeople(db: PrismaClient, actor: ChatActor, q: string) {
  const term = clean(q, 60);
  const rows = await db.user.findMany({
    where: { organizationId: actor.organizationId, active: true, userType: "EMPLOYEE", id: { not: actor.id }, ...(term ? { name: { contains: term, mode: "insensitive" } } : {}) },
    select: { id: true, name: true }, orderBy: { name: "asc" }, take: 40,
  });
  return rows;
}
