import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { ChatError, addMembers, createGroup, deleteMessage, history, listRooms, markRead, openDirect, removeMember, renameGroup, searchPeople, sendMessage, syncProjectRooms, totalUnread, type ChatActor } from "./chat";
import { _reset, isOnline, publishTo, subscribe } from "./chat-hub";
import { authorizeOwner, type FileActor } from "./file-access";
import { MemoryStorage } from "./storage";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
const storage = new MemoryStorage();
let org: string, org2: string;
let ann: ChatActor, bob: ChatActor, cat: ChatActor, dan: ChatActor, eve: ChatActor, zed: ChatActor;
const png = Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.alloc(64, 1)]);

const fileActor = (a: ChatActor, perms = ["chat.use"]): FileActor => ({ id: a.id, organizationId: a.organizationId, userType: "EMPLOYEE", clientId: null, vendorId: null, permissions: new Set(perms) });
const send = (a: ChatActor, roomId: string, p: { body?: string; image?: { name: string; bytes: Buffer } }) => sendMessage(db, storage, a, fileActor(a), roomId, p);

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "ChatMessage","ChatMember","ChatRoom","StoredFile","ProjectMember","Project","User","Organization" CASCADE');
  org = (await db.organization.create({ data: { name: "Chat Org" } })).id;
  org2 = (await db.organization.create({ data: { name: "Other Org" } })).id;
  const mk = async (name: string, organizationId = org, extra: Record<string, unknown> = {}): Promise<ChatActor> => {
    const u = await db.user.create({ data: { organizationId, email: `${name}@t.test`, name, passwordHash: "x", ...extra } });
    return { id: u.id, organizationId, name };
  };
  ann = await mk("Ann"); bob = await mk("Bob"); cat = await mk("Cat"); dan = await mk("Dan");
  eve = await mk("Eve", org, { userType: "CLIENT" });
  zed = await mk("Zed", org2);
});
afterAll(async () => { await db.$disconnect(); });

describe("direct messages", () => {
  it("opens one room per pair, whoever starts it, and names it after the other person", async () => {
    const a = await openDirect(db, ann, bob.id);
    const b = await openDirect(db, bob, ann.id);
    expect(b.id).toBe(a.id);
    const rooms = await listRooms(db, ann);
    expect(rooms.find((r) => r.id === a.id)?.name).toBe("Bob");
    expect((await listRooms(db, bob)).find((r) => r.id === a.id)?.name).toBe("Ann");
  });
  it("refuses yourself, clients, other organizations and unknown people", async () => {
    await expect(openDirect(db, ann, ann.id)).rejects.toThrow(ChatError);
    await expect(openDirect(db, ann, eve.id)).rejects.toThrow(/not available/);
    await expect(openDirect(db, ann, zed.id)).rejects.toThrow(/not available/);
    await expect(openDirect(db, ann, "nobody")).rejects.toThrow(/not available/);
  });
});

describe("messages, unread and read state", () => {
  it("counts unread for the other person only, and reading clears it", async () => {
    const room = await openDirect(db, ann, cat.id);
    await send(ann, room.id, { body: "  hello 👋  " });
    await send(ann, room.id, { body: "second" });
    const forCat = (await listRooms(db, cat)).find((r) => r.id === room.id)!;
    expect(forCat.unread).toBe(2);
    expect(forCat.lastMessage?.body).toBe("second");
    expect((await listRooms(db, ann)).find((r) => r.id === room.id)!.unread).toBe(0);
    expect(await totalUnread(db, cat.id)).toBe(2);
    const h = await history(db, cat, room.id);
    expect(h.messages.map((m) => m.body)).toEqual(["hello 👋", "second"]);
    await markRead(db, cat, room.id);
    expect(await totalUnread(db, cat.id)).toBe(0);
    // Ann sees that Cat has read up to now
    const seen = (await history(db, ann, room.id)).reads.find((r) => r.userId === cat.id)!;
    expect(new Date(seen.at).getTime()).toBeGreaterThanOrEqual(new Date(h.messages[1].createdAt).getTime());
  });
  it("rejects empty and over-long text, and pages through history", async () => {
    const room = await openDirect(db, ann, dan.id);
    await expect(send(ann, room.id, { body: "   " })).rejects.toThrow(/Write a message/);
    const long = await send(ann, room.id, { body: "x".repeat(5000) });
    expect(long.message.body.length).toBe(4000);
    for (let i = 0; i < 4; i++) await send(ann, room.id, { body: `m${i}` });
    const newest = await history(db, ann, room.id, { limit: 2 });
    expect(newest.messages.map((m) => m.body)).toEqual(["m2", "m3"]);
    expect(newest.hasMore).toBe(true);
    const older = await history(db, ann, room.id, { limit: 10, before: new Date(newest.messages[0].createdAt) });
    expect(older.messages.map((m) => m.body)).toEqual(["x".repeat(4000), "m0", "m1"]);
    expect(older.hasMore).toBe(false);
  });
  it("lets only the sender delete a message, and hides its text and picture afterwards", async () => {
    const room = await openDirect(db, bob, dan.id);
    const { message } = await send(bob, room.id, { body: "oops", image: { name: "a.png", bytes: png } });
    await expect(deleteMessage(db, dan, message.id)).rejects.toThrow(/not found/);
    await deleteMessage(db, bob, message.id);
    const m = (await history(db, dan, room.id)).messages.find((x) => x.id === message.id)!;
    expect(m.deleted).toBe(true);
    expect(m.body).toBe("");
    expect(m.attachments).toEqual([]);
    expect(await authorizeOwner(db, fileActor(dan), "CHAT_MESSAGE", message.id, "read")).toBe(false);
  });
});

describe("who can see a conversation", () => {
  it("treats a room you are not in exactly like a room that does not exist", async () => {
    const room = await openDirect(db, ann, bob.id);
    for (const outsider of [cat, zed]) {
      await expect(history(db, outsider, room.id)).rejects.toThrow(/not found/);
      await expect(send(outsider, room.id, { body: "hi" })).rejects.toThrow(/not found/);
      await expect(markRead(db, outsider, room.id)).rejects.toThrow(/not found/);
      expect((await listRooms(db, outsider)).some((r) => r.id === room.id)).toBe(false);
    }
  });
  it("searches only active staff of your own organization, never yourself", async () => {
    await db.user.update({ where: { id: dan.id }, data: { active: false } });
    const names = (await searchPeople(db, ann, "")).map((p) => p.name);
    expect(names).toEqual(expect.arrayContaining(["Bob", "Cat"]));
    expect(names).not.toContain("Ann");
    expect(names).not.toContain("Dan");
    expect(names).not.toContain("Eve");
    expect(names).not.toContain("Zed");
    expect((await searchPeople(db, ann, "bo")).map((p) => p.name)).toEqual(["Bob"]);
    await db.user.update({ where: { id: dan.id }, data: { active: true } });
  });
});

describe("pictures", () => {
  it("stores a picture with the message and shows it only to people in the room", async () => {
    const room = await createGroup(db, ann, { name: "Design", memberIds: [bob.id] });
    const { message } = await send(ann, room.id, { body: "mock-up", image: { name: "mock.png", bytes: png } });
    expect(message.kind).toBe("IMAGE");
    expect(message.attachments).toHaveLength(1);
    expect(message.attachments[0].contentType).toBe("image/png");
    expect(await authorizeOwner(db, fileActor(bob), "CHAT_MESSAGE", message.id, "read")).toBe(true);
    expect(await authorizeOwner(db, fileActor(cat), "CHAT_MESSAGE", message.id, "read")).toBe(false); // not in the room
    expect(await authorizeOwner(db, fileActor(zed), "CHAT_MESSAGE", message.id, "read")).toBe(false); // other organization
    expect(await authorizeOwner(db, fileActor(bob, []), "CHAT_MESSAGE", message.id, "read")).toBe(false); // lost the chat permission
    expect(await authorizeOwner(db, fileActor(bob), "CHAT_MESSAGE", message.id, "delete")).toBe(false); // only the sender removes it
    expect(await authorizeOwner(db, fileActor(ann), "CHAT_MESSAGE", message.id, "delete")).toBe(true);
    await removeMember(db, ann, room.id, bob.id);
    expect(await authorizeOwner(db, fileActor(bob), "CHAT_MESSAGE", message.id, "read")).toBe(false); // removed from the room
  });
  it("refuses non-pictures, disguised files and leaves no empty message behind", async () => {
    const room = await openDirect(db, ann, bob.id);
    const before = await db.chatMessage.count({ where: { roomId: room.id } });
    await expect(send(ann, room.id, { image: { name: "doc.pdf", bytes: Buffer.from("%PDF-1.4 x") } })).rejects.toThrow(/Only pictures/);
    await expect(send(ann, room.id, { image: { name: "fake.png", bytes: Buffer.from("<html><script>1</script>") } })).rejects.toThrow(/do not match/);
    await expect(send(ann, room.id, { image: { name: "x.svg", bytes: Buffer.from("<svg/>") } })).rejects.toThrow(ChatError);
    expect(await db.chatMessage.count({ where: { roomId: room.id } })).toBe(before);
  });
});

describe("groups", () => {
  it("lets only admins rename, add and remove, keeps an admin, and stops removed people reading", async () => {
    const room = await createGroup(db, ann, { name: "  Sales team ", memberIds: [bob.id, cat.id, bob.id] });
    expect((await listRooms(db, ann)).find((r) => r.id === room.id)).toMatchObject({ name: "Sales team", isAdmin: true });
    expect((await listRooms(db, bob)).find((r) => r.id === room.id)).toMatchObject({ isAdmin: false });
    expect((await history(db, bob, room.id)).messages[0].kind).toBe("SYSTEM");
    await expect(renameGroup(db, bob, room.id, "Mine")).rejects.toThrow(/admin/);
    await expect(addMembers(db, bob, room.id, [dan.id])).rejects.toThrow(/admin/);
    await expect(removeMember(db, bob, room.id, cat.id)).rejects.toThrow(/admin/);
    await expect(addMembers(db, ann, room.id, [eve.id])).rejects.toThrow(/not available/);
    await expect(addMembers(db, ann, room.id, [zed.id])).rejects.toThrow(/not available/);
    await addMembers(db, ann, room.id, [dan.id]);
    await renameGroup(db, ann, room.id, "Sales & Growth");
    await send(dan, room.id, { body: "hi all" });
    await removeMember(db, ann, room.id, dan.id);
    await expect(history(db, dan, room.id)).rejects.toThrow(/not found/);
    // Dan returns later: what he missed, and the "added" notice, are not counted as new
    await addMembers(db, ann, room.id, [dan.id]);
    expect((await listRooms(db, dan)).find((r) => r.id === room.id)!.unread).toBe(0);
    // The only admin leaves: the longest-standing member takes over
    await removeMember(db, ann, room.id, ann.id);
    expect((await listRooms(db, bob)).find((r) => r.id === room.id)!.isAdmin).toBe(true);
    await expect(removeMember(db, ann, room.id, ann.id)).rejects.toThrow(/not found/);
  });
  it("validates names and members, and direct rooms cannot be left or managed", async () => {
    await expect(createGroup(db, ann, { name: "x", memberIds: [bob.id] })).rejects.toThrow(/name/);
    await expect(createGroup(db, ann, { name: "Alone", memberIds: [ann.id] })).rejects.toThrow(/at least one other/);
    await expect(createGroup(db, ann, { name: "Mixed", memberIds: [bob.id, zed.id] })).rejects.toThrow(/not available/);
    const direct = await openDirect(db, ann, bob.id);
    await expect(removeMember(db, ann, direct.id, ann.id)).rejects.toThrow(/cannot leave/);
    await expect(addMembers(db, ann, direct.id, [cat.id])).rejects.toThrow(/managed automatically/);
  });
});

describe("project rooms", () => {
  it("creates a room for each project with its team, and drops people who leave the project", async () => {
    const p = await db.project.create({ data: { organizationId: org, number: "PRJ-9", name: "Site rebuild", managerId: ann.id } });
    await db.projectMember.createMany({ data: [{ projectId: p.id, userId: ann.id }, { projectId: p.id, userId: bob.id }] });
    await syncProjectRooms(db, ann);
    await syncProjectRooms(db, bob);
    const room = (await listRooms(db, bob)).find((r) => r.projectId === p.id)!;
    expect(room).toMatchObject({ kind: "PROJECT", name: "PRJ-9 Site rebuild" });
    expect(room.members.map((m) => m.name).sort()).toEqual(["Ann", "Bob"]);
    expect(await db.chatRoom.count({ where: { projectId: p.id } })).toBe(1); // synced twice, one room
    await expect(history(db, cat, room.id)).rejects.toThrow(/not found/); // not on the project
    await db.projectMember.delete({ where: { projectId_userId: { projectId: p.id, userId: bob.id } } });
    await syncProjectRooms(db, bob);
    expect((await listRooms(db, bob)).some((r) => r.projectId === p.id)).toBe(false);
    expect((await listRooms(db, ann)).some((r) => r.projectId === p.id)).toBe(true);
  });
});

describe("live hub", () => {
  it("delivers only to the people named, across several tabs", () => {
    _reset();
    const got: string[] = [];
    const off1 = subscribe("u1", (e) => got.push(`u1a:${e}`));
    subscribe("u1", (e) => got.push(`u1b:${e}`));
    subscribe("u2", (e) => got.push(`u2:${e}`));
    expect(publishTo(["u1", "u3", "u1"], "message", {})).toBe(2);
    expect(got.sort()).toEqual(["u1a:message", "u1b:message"]);
    off1();
    expect(isOnline("u1")).toBe(true);
    expect(isOnline("u3")).toBe(false);
    _reset();
  });
});
