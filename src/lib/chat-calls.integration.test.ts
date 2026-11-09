import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { ChatError, createGroup, history, listRooms, openDirect, type ChatActor } from "./chat";
import { afterLeave, answerCall, cancelCall, declineCall, expireCall, parseCall, startCall, sweepStaleCalls } from "./chat-calls";
import { authenticateParticipant, leave } from "./meetings";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
let ann: ChatActor, bob: ChatActor, cat: ChatActor, zed: ChatActor;

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "MeetingParticipant","MeetingMessage","Meeting","ChatMessage","ChatMember","ChatRoom","User","Organization" CASCADE');
  const org = (await db.organization.create({ data: { name: "Call Org" } })).id;
  const org2 = (await db.organization.create({ data: { name: "Other" } })).id;
  const mk = async (name: string, organizationId = org, extra: Record<string, unknown> = {}): Promise<ChatActor> => {
    const u = await db.user.create({ data: { organizationId, email: `${name}@c.test`, name, passwordHash: "x", ...extra } });
    return { id: u.id, organizationId, name };
  };
  ann = await mk("Ann"); bob = await mk("Bob"); cat = await mk("Cat"); zed = await mk("Zed", org2);
});
afterAll(async () => { await db.$disconnect(); });

const statusOf = async (messageId: string) => parseCall((await db.chatMessage.findUniqueOrThrow({ where: { id: messageId } })).body)!;

describe("starting a call", () => {
  it("creates a call room with the caller in it, and rings the other person", async () => {
    const room = await openDirect(db, ann, bob.id);
    const r = await startCall(db, ann, room.id, "video");
    expect(r.calleeId).toBe(bob.id);
    expect(r.message.kind).toBe("CALL");
    expect(r.call).toMatchObject({ mode: "video", status: "RINGING" });
    const m = await db.meeting.findUniqueOrThrow({ where: { id: r.meetingId } });
    expect(m).toMatchObject({ purpose: "CALL", status: "LIVE", waitingRoom: true, hostId: ann.id });
    expect((await authenticateParticipant(db, r.meetingId, r.ticket))?.userId).toBe(ann.id);
    // the callee sees it as an unread message in their conversation list
    expect((await listRooms(db, bob)).find((x) => x.id === room.id)).toMatchObject({ unread: 1, lastMessage: { kind: "CALL" } });
    await cancelCall(db, ann, r.message.id);
  });
  it("only works in direct conversations between people who can be called", async () => {
    await expect(startCall(db, ann, (await createGroup(db, ann, { name: "Team", memberIds: [bob.id] })).id, "audio")).rejects.toThrow(/direct conversations/);
    const room = await openDirect(db, ann, cat.id);
    await expect(startCall(db, ann, room.id, "hologram")).rejects.toThrow(/voice or video/);
    await expect(startCall(db, bob, room.id, "audio")).rejects.toThrow(/not found/); // not in that room
    await expect(startCall(db, zed, room.id, "audio")).rejects.toThrow(/not found/); // other organization
    await db.user.update({ where: { id: cat.id }, data: { active: false } });
    await expect(startCall(db, ann, room.id, "audio")).rejects.toThrow(/not available/);
    await db.user.update({ where: { id: cat.id }, data: { active: true } });
  });
  it("allows one call at a time per conversation", async () => {
    const room = await openDirect(db, ann, cat.id);
    const first = await startCall(db, ann, room.id, "audio");
    await expect(startCall(db, cat, room.id, "video")).rejects.toThrow(/already a call/);
    await cancelCall(db, ann, first.message.id);
    const second = await startCall(db, cat, room.id, "video"); // free again once the first is over
    await cancelCall(db, cat, second.message.id);
  });
});

describe("answering, declining, cancelling", () => {
  it("lets the callee answer once and joins them to the room", async () => {
    const room = await openDirect(db, ann, bob.id);
    const r = await startCall(db, ann, room.id, "audio");
    await expect(answerCall(db, ann, r.message.id)).rejects.toThrow(/You started/);
    await expect(answerCall(db, cat, r.message.id)).rejects.toThrow(/not found/); // not in the conversation
    await expect(answerCall(db, zed, r.message.id)).rejects.toThrow(/not found/);
    const a = await answerCall(db, bob, r.message.id);
    expect(a.mode).toBe("audio");
    expect((await authenticateParticipant(db, r.meetingId, a.ticket))?.userId).toBe(bob.id);
    expect((await statusOf(r.message.id)).status).toBe("ANSWERED");
    await expect(answerCall(db, bob, r.message.id)).rejects.toThrow(/no longer ringing/);
    await expect(declineCall(db, bob, r.message.id)).rejects.toThrow(/no longer ringing/);
    await expect(cancelCall(db, ann, r.message.id)).rejects.toThrow(/no longer ringing/);
    // both leave: the call ends with its length
    for (const t of [r.ticket, a.ticket]) { const p = await authenticateParticipant(db, r.meetingId, t); await leave(db, p!.id); }
    const done = await afterLeave(db, r.meetingId);
    expect(done?.message.id).toBe(r.message.id);
    expect(await statusOf(r.message.id)).toMatchObject({ status: "ENDED" });
    expect((await statusOf(r.message.id)).durationSec).toBeGreaterThanOrEqual(1);
    expect((await db.meeting.findUniqueOrThrow({ where: { id: r.meetingId } })).status).toBe("ENDED");
  });
  it("declining or cancelling ends the room and marks the call", async () => {
    const room = await openDirect(db, ann, bob.id);
    const d = await startCall(db, ann, room.id, "video");
    await expect(declineCall(db, ann, d.message.id)).rejects.toThrow(/You started/);
    await declineCall(db, bob, d.message.id);
    expect((await statusOf(d.message.id)).status).toBe("DECLINED");
    expect((await db.meeting.findUniqueOrThrow({ where: { id: d.meetingId } })).status).toBe("ENDED");
    const c = await startCall(db, bob, room.id, "audio");
    await expect(cancelCall(db, ann, c.message.id)).rejects.toThrow(/Only the caller/);
    await cancelCall(db, bob, c.message.id);
    expect((await statusOf(c.message.id)).status).toBe("MISSED");
  });
  it("closes a ringing call as missed when the caller leaves the room, or when it times out", async () => {
    const room = await openDirect(db, ann, bob.id);
    const r = await startCall(db, ann, room.id, "audio");
    const p = await authenticateParticipant(db, r.meetingId, r.ticket);
    await leave(db, p!.id);
    await afterLeave(db, r.meetingId);
    expect((await statusOf(r.message.id)).status).toBe("MISSED");
    const t = await startCall(db, ann, room.id, "audio");
    expect((await expireCall(db, t.message.id))?.message.id).toBe(t.message.id);
    expect((await statusOf(t.message.id)).status).toBe("MISSED");
    expect(await expireCall(db, t.message.id)).toBeNull(); // already settled
  });
  it("sweeps calls left ringing by a restart, and does not touch ordinary meetings", async () => {
    const room = await openDirect(db, ann, bob.id);
    const r = await startCall(db, ann, room.id, "audio");
    await db.chatMessage.update({ where: { id: r.message.id }, data: { createdAt: new Date(Date.now() - 5 * 60_000) } });
    await sweepStaleCalls(db, room.id);
    expect((await statusOf(r.message.id)).status).toBe("MISSED");
    const plain = await db.meeting.create({ data: { organizationId: ann.organizationId, hostId: ann.id, title: "Plan", joinToken: "a".repeat(32) } });
    expect(await afterLeave(db, plain.id)).toBeNull();
    expect((await db.meeting.findUniqueOrThrow({ where: { id: plain.id } })).status).toBe("SCHEDULED");
  });
  it("keeps call messages out of delete and shows them in history", async () => {
    const room = await openDirect(db, ann, bob.id);
    const msgs = (await history(db, ann, room.id)).messages.filter((m) => m.kind === "CALL");
    expect(msgs.length).toBeGreaterThan(0);
    expect(parseCall(msgs[0].body)).not.toBeNull();
    const { deleteMessage } = await import("./chat");
    await expect(deleteMessage(db, ann, msgs[0].id)).rejects.toThrow(ChatError);
  });
});
