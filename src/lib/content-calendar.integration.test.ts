import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { ContentError, createContent, editContent, reschedule, transition } from "./content";
import { canTransition, isDate, isTime } from "./content-rules";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
let org: string, ann: string, bob: string, client: string;

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "ContentEvent","ContentVersion","ContentItem","Client","User","Organization" CASCADE');
  org = (await db.organization.create({ data: { name: "Content Org" } })).id;
  const mk = (e: string) => db.user.create({ data: { organizationId: org, email: e, name: e, passwordHash: "x" } }).then((u) => u.id);
  ann = await mk("ann@c.test"); bob = await mk("bob@c.test");
  client = (await db.client.create({ data: { organizationId: org, name: "Acme" } })).id;
});
afterAll(async () => { await db.$disconnect(); });

const post = (over: Partial<Parameters<typeof createContent>[1]> = {}) =>
  createContent(db, { organizationId: org, createdById: ann, title: "Plots now open", copy: "Book a visit", platforms: ["INSTAGRAM", "FACEBOOK"], postType: "REEL", plannedDate: "2026-10-20", plannedTime: "18:00", ...over });

describe("planning a post", () => {
  it("stores several platforms, the type and the time, with the first platform as the main one", async () => {
    const p = await post({ clientId: client, platforms: ["TIKTOK", "YOUTUBE", "TIKTOK"] });
    expect(p).toMatchObject({ platform: "TIKTOK", platforms: ["TIKTOK", "YOUTUBE"], postType: "REEL", plannedDate: "2026-10-20", plannedTime: "18:00", clientId: client, status: "DRAFT" });
    expect(await post()).toMatchObject({ clientId: null });
  });

  it("validates platforms, type, date, time, title, client and assignee", async () => {
    await expect(post({ platforms: [] })).rejects.toThrow(/at least one platform/);
    await expect(post({ platforms: ["MYSPACE"] })).rejects.toThrow(/from the list/);
    await expect(post({ postType: "GIF" })).rejects.toThrow(/post type/);
    await expect(post({ plannedDate: "20-10-2026" })).rejects.toThrow(/posting date/);
    await expect(post({ plannedTime: "25:00" })).rejects.toThrow(/posting time/);
    await expect(post({ plannedDate: undefined, plannedTime: "09:00" })).rejects.toThrow(/date as well/);
    await expect(post({ title: " " })).rejects.toThrow(/title/);
    await expect(post({ clientId: "ghost" })).rejects.toThrow(/client/);
    await expect(post({ assignedToId: "ghost" })).rejects.toThrow(/staff member/);
  });

  it("date and time helpers are strict", () => {
    expect(isDate("2026-02-30")).toBe(false);
    expect(isDate("2026-02-28")).toBe(true);
    expect(isTime("23:59")).toBe(true);
    expect(isTime("7:30")).toBe(false);
  });
});

describe("moving a post to another day", () => {
  it("reschedules in any status except Published, without making a new version", async () => {
    const p = await post();
    const moved = await reschedule(db, { organizationId: org, id: p.id, plannedDate: "2026-10-25" });
    expect(moved).toMatchObject({ plannedDate: "2026-10-25", plannedTime: "18:00", version: 1 });
    expect((await reschedule(db, { organizationId: org, id: p.id, plannedDate: "2026-10-26", plannedTime: "09:30" })).plannedTime).toBe("09:30");
    await expect(reschedule(db, { organizationId: org, id: p.id, plannedDate: "tomorrow" })).rejects.toThrow(/valid date/);
    await expect(reschedule(db, { organizationId: "other", id: p.id, plannedDate: "2026-10-25" })).rejects.toThrow(/not found/);
    await db.contentItem.update({ where: { id: p.id }, data: { status: "PUBLISHED" } });
    await expect(reschedule(db, { organizationId: org, id: p.id, plannedDate: "2026-10-27" })).rejects.toThrow(/published/);
  });
});

describe("the company's own posts (no client)", () => {
  it("are approved by internal review, never sent to a client, and the author cannot approve their own", () => {
    expect(canTransition("STAFF", "INTERNAL_REVIEW", "APPROVED", false)).toBe(true);
    expect(canTransition("STAFF", "INTERNAL_REVIEW", "CLIENT_REVIEW", false)).toBe(false);
    expect(canTransition("STAFF", "INTERNAL_REVIEW", "APPROVED", true)).toBe(false); // a client's post still needs the client
    expect(canTransition("STAFF", "INTERNAL_REVIEW", "CLIENT_REVIEW", true)).toBe(true);
  });

  it("move through draft, review and approved in the database", async () => {
    const p = await post();
    await transition(db, { organizationId: org, id: p.id, actor: { id: ann, type: "STAFF" }, to: "INTERNAL_REVIEW" });
    await expect(transition(db, { organizationId: org, id: p.id, actor: { id: bob, type: "STAFF" }, to: "CLIENT_REVIEW" })).rejects.toThrow(ContentError);
    expect((await transition(db, { organizationId: org, id: p.id, actor: { id: bob, type: "STAFF" }, to: "APPROVED" })).status).toBe("APPROVED");
  });
});

describe("editing", () => {
  it("changes platforms, type and time, creates a version only when the wording changes, and keeps the first platform in sync", async () => {
    const p = await post({ clientId: client });
    const e = await editContent(db, { organizationId: org, id: p.id, copy: "Book a visit", platforms: ["LINKEDIN"], postType: "STATIC", plannedTime: "10:15" });
    expect(e).toMatchObject({ version: 1, platform: "LINKEDIN", platforms: ["LINKEDIN"], postType: "STATIC", plannedTime: "10:15" });
    expect((await editContent(db, { organizationId: org, id: p.id, copy: "New wording" })).version).toBe(2);
    await expect(editContent(db, { organizationId: org, id: p.id, copy: "x", platforms: [] })).rejects.toThrow(/at least one platform/);
  });
});
