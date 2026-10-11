import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { MAX_PEOPLE, MeetingError, attendance, authenticateParticipant, cancelMeeting, createMeeting, decide, endMeeting, guestLink, history, iceServers, joinAsGuest, joinAsStaff, leave, postMessage } from "./meetings";
import { _reset, isOnline, online, publish, subscribe } from "./meeting-hub";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
let org: string, other: string, host: string, mate: string, outsider: string, client: string, project: string;
const u = (id: string, name: string, organizationId = org) => ({ id, name, organizationId });

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "MeetingMessage","MeetingParticipant","Meeting","Project","Client","User","Organization" CASCADE');
  org = (await db.organization.create({ data: { name: "Meet Org" } })).id;
  other = (await db.organization.create({ data: { name: "Other" } })).id;
  const mk = (e: string, organizationId = org) => db.user.create({ data: { organizationId, email: e, name: e, passwordHash: "x" } }).then((x) => x.id);
  host = await mk("host@m.test"); mate = await mk("mate@m.test"); outsider = await mk("out@m.test", other);
  client = (await db.client.create({ data: { organizationId: org, name: "Acme", currency: "USD" } })).id;
  project = (await db.project.create({ data: { organizationId: org, number: "PRJ-1", name: "Site", managerId: host, currency: "USD" } })).id;
});
beforeEach(() => _reset());
afterAll(async () => { await db.$disconnect(); });

const mk = (over: Partial<Parameters<typeof createMeeting>[1]> = {}) => createMeeting(db, { organizationId: org, hostId: host, title: "Kickoff", ...over });

describe("creating", () => {
  it("validates input and ties a meeting to a real project and client of this organization", async () => {
    await expect(mk({ title: " " })).rejects.toThrow(MeetingError);
    await expect(mk({ kind: "PARTY" })).rejects.toThrow(MeetingError);
    await expect(mk({ durationMin: 2 })).rejects.toThrow(/Duration/);
    await expect(mk({ scheduledAt: "not a date" })).rejects.toThrow(/date/);
    await expect(mk({ projectId: "nope" })).rejects.toThrow(/project/);
    await expect(createMeeting(db, { organizationId: other, hostId: outsider, title: "x", clientId: client })).rejects.toThrow(/client/);
    const m = await mk({ kind: "WORKSHOP", projectId: project, clientId: client, agenda: "Brand workshop", scheduledAt: "2026-11-01T10:00:00Z" });
    expect(m.joinToken).toMatch(/^[0-9a-f]{32}$/);
    expect(m.waitingRoom).toBe(true);
    expect((await mk()).joinToken).not.toBe(m.joinToken);
  });
});

describe("joining", () => {
  it("staff join directly, the first person makes it live, and rejoining keeps the same identity", async () => {
    const m = await mk();
    const a = await joinAsStaff(db, { meetingId: m.id, user: u(host, "Hana Host") });
    expect(a.participant.isHost).toBe(true);
    expect(a.participant.status).toBe("ADMITTED");
    expect(a.meeting.status).toBe("LIVE");
    const again = await joinAsStaff(db, { meetingId: m.id, user: u(host, "Hana Host") });
    expect(again.participant.id).toBe(a.participant.id);
    expect(again.participant.ticket).toBe(a.participant.ticket);
    expect((await joinAsStaff(db, { meetingId: m.id, user: u(mate, "Mo Mate") })).participant.isHost).toBe(false);
  });

  it("other organizations' staff cannot join", async () => {
    const m = await mk();
    await expect(joinAsStaff(db, { meetingId: m.id, user: u(outsider, "Spy", other) })).rejects.toThrow(/not found/);
  });

  it("guests wait in a lobby with a clean name, and a bad link is refused", async () => {
    const m = await mk();
    const g = await joinAsGuest(db, { joinToken: m.joinToken, name: "  Client <b>Cathy</b>\u0007 " });
    expect(g.participant.status).toBe("WAITING");
    expect(g.participant.name).toBe("Client bCathy/b");
    await expect(joinAsGuest(db, { joinToken: m.joinToken, name: "x" })).rejects.toThrow(/name/);
    await expect(joinAsGuest(db, { joinToken: "zz", name: "Bob" })).rejects.toThrow(/not valid/);
    await expect(joinAsGuest(db, { joinToken: "0".repeat(32), name: "Bob" })).rejects.toThrow(/no longer valid/);
  });

  it("with the waiting room off, guests are in at once", async () => {
    const m = await mk({ waitingRoom: false });
    expect((await joinAsGuest(db, { joinToken: m.joinToken, name: "Walk In" })).participant.status).toBe("ADMITTED");
  });

  it("caps the number of people in the call", async () => {
    const m = await mk({ waitingRoom: false });
    for (let i = 0; i < MAX_PEOPLE; i++) await joinAsGuest(db, { joinToken: m.joinToken, name: `Guest ${i + 1}` });
    await expect(joinAsGuest(db, { joinToken: m.joinToken, name: "One too many" })).rejects.toThrow(/full/);
    await expect(joinAsStaff(db, { meetingId: m.id, user: u(host, "Hana") })).rejects.toThrow(/full/);
  });
});

describe("the host's controls", () => {
  it("only the host can admit; a waiting guest cannot act or chat until admitted", async () => {
    const m = await mk();
    const h = (await joinAsStaff(db, { meetingId: m.id, user: u(host, "Hana") })).participant;
    const mateP = (await joinAsStaff(db, { meetingId: m.id, user: u(mate, "Mo") })).participant;
    const g = (await joinAsGuest(db, { joinToken: m.joinToken, name: "Cathy" })).participant;
    await expect(postMessage(db, { meetingId: m.id, ticket: g.ticket, body: "hello?" })).rejects.toThrow(/not in this meeting/);
    await expect(decide(db, { meetingId: m.id, actorTicket: g.ticket, targetId: g.id, action: "ADMIT" })).rejects.toThrow(/host/);
    await expect(decide(db, { meetingId: m.id, actorTicket: mateP.ticket, targetId: g.id, action: "ADMIT" })).rejects.toThrow(/host/);
    await decide(db, { meetingId: m.id, actorTicket: h.ticket, targetId: g.id, action: "ADMIT" });
    expect((await postMessage(db, { meetingId: m.id, ticket: g.ticket, body: "hello!" })).authorName).toBe("Cathy");
    await expect(decide(db, { meetingId: m.id, actorTicket: h.ticket, targetId: g.id, action: "ADMIT" })).rejects.toThrow(/not waiting/);
  });

  it("deny and remove cut a person off at once", async () => {
    const m = await mk();
    const h = (await joinAsStaff(db, { meetingId: m.id, user: u(host, "Hana") })).participant;
    const g1 = (await joinAsGuest(db, { joinToken: m.joinToken, name: "Denied Dan" })).participant;
    const g2 = (await joinAsGuest(db, { joinToken: m.joinToken, name: "Removed Rae" })).participant;
    await decide(db, { meetingId: m.id, actorTicket: h.ticket, targetId: g1.id, action: "DENY" });
    expect(await authenticateParticipant(db, m.id, g1.ticket)).toBeNull();
    await decide(db, { meetingId: m.id, actorTicket: h.ticket, targetId: g2.id, action: "ADMIT" });
    expect(await authenticateParticipant(db, m.id, g2.ticket)).not.toBeNull();
    await decide(db, { meetingId: m.id, actorTicket: h.ticket, targetId: g2.id, action: "REMOVE" });
    expect(await authenticateParticipant(db, m.id, g2.ticket)).toBeNull();
    await expect(decide(db, { meetingId: m.id, actorTicket: h.ticket, targetId: h.id, action: "REMOVE" })).rejects.toThrow(/yourself/);
  });

  it("a ticket from another meeting or a made-up ticket proves nothing", async () => {
    const a = await mk(), b = await mk();
    const pa = (await joinAsStaff(db, { meetingId: a.id, user: u(host, "Hana") })).participant;
    expect(await authenticateParticipant(db, b.id, pa.ticket)).toBeNull();
    expect(await authenticateParticipant(db, a.id, "f".repeat(32))).toBeNull();
    expect(await authenticateParticipant(db, a.id, "short")).toBeNull();
    expect(await authenticateParticipant(db, a.id, null)).toBeNull();
  });

  it("ending the meeting disconnects everyone and kills the link", async () => {
    const m = await mk({ waitingRoom: false });
    const h = (await joinAsStaff(db, { meetingId: m.id, user: u(host, "Hana") })).participant;
    const g = (await joinAsGuest(db, { joinToken: m.joinToken, name: "Cathy" })).participant;
    await expect(endMeeting(db, { meetingId: m.id, actorTicket: g.ticket })).rejects.toThrow(/host/);
    await endMeeting(db, { meetingId: m.id, actorTicket: h.ticket });
    expect(await authenticateParticipant(db, m.id, g.ticket)).toBeNull();
    await expect(joinAsGuest(db, { joinToken: m.joinToken, name: "Late Larry" })).rejects.toThrow(/no longer valid/);
    await expect(joinAsStaff(db, { meetingId: m.id, user: u(mate, "Mo") })).rejects.toThrow(/ended/);
    expect((await db.meeting.findUniqueOrThrow({ where: { id: m.id } })).status).toBe("ENDED");
  });

  it("only an unstarted meeting can be cancelled, and only by its host", async () => {
    const m = await mk();
    await expect(cancelMeeting(db, { organizationId: org, meetingId: m.id, userId: mate })).rejects.toThrow(/host/);
    await cancelMeeting(db, { organizationId: org, meetingId: m.id, userId: host });
    await expect(joinAsGuest(db, { joinToken: m.joinToken, name: "Cathy" })).rejects.toThrow(/no longer valid/);
    const live = await mk();
    await joinAsStaff(db, { meetingId: live.id, user: u(host, "Hana") });
    await expect(cancelMeeting(db, { organizationId: org, meetingId: live.id, userId: host })).rejects.toThrow(/not started/);
  });
});

describe("chat and attendance", () => {
  it("stores messages in order, limits them, and shows history only to people already in", async () => {
    const m = await mk();
    const h = (await joinAsStaff(db, { meetingId: m.id, user: u(host, "Hana") })).participant;
    await expect(postMessage(db, { meetingId: m.id, ticket: h.ticket, body: "   " })).rejects.toThrow(/Type a message/);
    await expect(postMessage(db, { meetingId: m.id, ticket: h.ticket, body: "x".repeat(1001) })).rejects.toThrow(/1000/);
    await postMessage(db, { meetingId: m.id, ticket: h.ticket, body: "First" });
    await postMessage(db, { meetingId: m.id, ticket: h.ticket, body: "<script>alert(1)</script>" });
    const hist = await history(db, m.id);
    expect(hist.map((x) => x.body)).toEqual(["First", "<script>alert(1)</script>"]); // stored as text; the page shows it as text
    expect(hist[0].authorName).toBe("Hana");
  });

  it("records who attended and for how long", async () => {
    const m = await mk({ waitingRoom: false });
    const h = (await joinAsStaff(db, { meetingId: m.id, user: u(host, "Hana") })).participant;
    const g = (await joinAsGuest(db, { joinToken: m.joinToken, name: "Cathy" })).participant;
    await db.meetingParticipant.update({ where: { id: g.id }, data: { admittedAt: new Date(Date.now() - 30 * 60000) } });
    await leave(db, g.id);
    const a = await attendance(db, m.id);
    expect(a.map((x) => x.name).sort()).toEqual(["Cathy", "Hana"]);
    expect(a.find((x) => x.name === "Cathy")!.minutes).toBeGreaterThanOrEqual(29);
    expect(a.find((x) => x.name === "Hana")!.host).toBe(true);
    void h;
  });
});

describe("live hub", () => {
  it("delivers to the right people only and cleans up", () => {
    const got: Record<string, unknown[]> = { a: [], b: [], c: [] };
    const off = ["a", "b", "c"].map((id) => subscribe("m1", id, (e, d) => got[id].push([e, d])));
    expect(online("m1").sort()).toEqual(["a", "b", "c"]);
    publish("m1", "signal", { x: 1 }, { to: "b" });
    publish("m1", "chat", { y: 2 }, { except: "a" });
    publish("m1", "roster", { z: 3 }, { only: ["a", "c"] });
    expect(got.a).toEqual([["roster", { z: 3 }]]);
    expect(got.b).toEqual([["signal", { x: 1 }], ["chat", { y: 2 }]]);
    expect(got.c).toEqual([["chat", { y: 2 }], ["roster", { z: 3 }]]);
    off[1]();
    expect(isOnline("m1", "b")).toBe(false);
    expect(publish("other-meeting", "x", {})).toBe(0);
  });
  it("a newer connection by the same person replaces the old one without being removed when the old one closes", () => {
    const got: string[] = [];
    const first = subscribe("m2", "p", () => got.push("old"));
    subscribe("m2", "p", () => got.push("new"));
    first(); // the old stream closing must not drop the new one
    publish("m2", "x", {});
    expect(got).toEqual(["new"]);
  });
});

describe("configuration", () => {
  it("uses public STUN by default and accepts a valid ICE_SERVERS list", () => {
    expect(iceServers({})[0].urls).toContain("stun:stun.l.google.com:19302");
    expect(iceServers({ ICE_SERVERS: JSON.stringify([{ urls: "turn:t.example.com", username: "u", credential: "c" }]) })[0]).toMatchObject({ username: "u" });
    expect(iceServers({ ICE_SERVERS: "{not json" })[0].urls).toContain("stun:stun.l.google.com:19302");
    expect(iceServers({ ICE_SERVERS: JSON.stringify([{ nope: 1 }]) })[0].urls).toContain("stun:stun.l.google.com:19302");
  });
  it("builds the guest link from the base address", () => {
    expect(guestLink("https://erp.example.com/", "abc")).toBe("https://erp.example.com/join/abc");
  });
});
