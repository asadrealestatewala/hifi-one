import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { canSeeContentClient, canSeeContentId, contentClientIds, contentWhere, visibleContentIds, type ContentViewer } from "./content-scope";
import { authorizeOwner } from "./file-access";
import { eventsForToken } from "./calendar";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
let org: string, otherOrg: string, designer: string, pm: string, boss: string, hb: string, food: string, ace: string, oldClient: string;
let hbPost: string, acePost: string, ownPost: string, aceAssigned: string, otherOrgPost: string;

const viewer = (id: string, perms: string[] = ["content.view", "content.manage"]): ContentViewer => ({ id, organizationId: org, permissions: new Set(perms) });
const actor = (id: string, perms: string[] = ["content.view", "content.manage"]) => ({ ...viewer(id, perms), userType: "EMPLOYEE", clientId: null, vendorId: null });

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "ContentEvent","ContentVersion","ContentItem","ProjectMember","Project","Client","UserRole","RolePermission","Role","User","Organization" CASCADE');
  org = (await db.organization.create({ data: { name: "Scope Org" } })).id;
  otherOrg = (await db.organization.create({ data: { name: "Other Org" } })).id;
  const mk = (e: string, o = org) => db.user.create({ data: { organizationId: o, email: e, name: e, passwordHash: "x" } }).then((u) => u.id);
  designer = await mk("huzaifa@s.test"); pm = await mk("pm@s.test"); boss = await mk("ceo@s.test");
  const cl = (name: string, o = org) => db.client.create({ data: { organizationId: o, name } }).then((c) => c.id);
  hb = await cl("HB Elan"); food = await cl("Food Ventures"); ace = await cl("Ace Real Estate"); oldClient = await cl("Cancelled Co");
  const project = (name: string, clientId: string, managerId: string, status = "ACTIVE") =>
    db.project.create({ data: { organizationId: org, number: name, name, clientId, managerId, status } }).then((p) => p.id);
  const hbP = await project("P-1", hb, pm);
  await project("P-2", food, pm);
  await project("P-3", ace, boss);
  const cancelled = await project("P-4", oldClient, boss, "CANCELLED");
  await db.projectMember.createMany({ data: [{ projectId: hbP, userId: designer }, { projectId: cancelled, userId: designer }] });
  const post = (title: string, clientId: string | null, assignedToId: string | null = null, o = org) =>
    db.contentItem.create({ data: { organizationId: o, title, copy: "x", platform: "INSTAGRAM", platforms: ["INSTAGRAM"], clientId, assignedToId, createdById: boss } }).then((p) => p.id);
  hbPost = await post("HB post", hb);
  acePost = await post("Ace post", ace);
  ownPost = await post("Our own post", null);
  aceAssigned = await post("Ace post for Huzaifa", ace, designer);
  otherOrgPost = await post("Elsewhere", null, null, otherOrg);
});
afterAll(async () => { await db.$disconnect(); });

describe("who sees which client's content", () => {
  it("a designer sees only the clients of live projects they are on", async () => {
    expect(await contentClientIds(db, viewer(designer))).toEqual([hb]);
  });

  it("a project manager sees the clients of the projects they manage, and no others", async () => {
    expect((await contentClientIds(db, viewer(pm)))?.sort()).toEqual([hb, food].sort());
    expect(await canSeeContentClient(db, viewer(pm), ace)).toBe(false);
  });

  it("someone who may see every project sees every client and the company's own posts", async () => {
    const ceo = viewer(boss, ["content.view", "projects.view_all"]);
    expect(await contentClientIds(db, ceo)).toBeNull();
    expect(await canSeeContentClient(db, ceo, null)).toBe(true);
    const rows = await db.contentItem.findMany({ where: await contentWhere(db, ceo), select: { id: true } });
    expect(rows.map((r) => r.id).sort()).toEqual([hbPost, acePost, ownPost, aceAssigned].sort());
  });

  it("the calendar query for a designer returns their client's posts plus posts assigned to them, never another organization's", async () => {
    const rows = await db.contentItem.findMany({ where: await contentWhere(db, viewer(designer)), select: { id: true } });
    expect(rows.map((r) => r.id).sort()).toEqual([hbPost, aceAssigned].sort());
  });

  it("denies a direct link to another client's post and to the company's own posts", async () => {
    expect(await canSeeContentId(db, viewer(designer), acePost)).toBe(false);
    expect(await canSeeContentId(db, viewer(designer), ownPost)).toBe(false);
    expect(await canSeeContentId(db, viewer(designer), otherOrgPost)).toBe(false);
    expect(await canSeeContentId(db, viewer(designer), hbPost)).toBe(true);
    expect(await canSeeContentId(db, viewer(designer), aceAssigned)).toBe(true);
    expect(await canSeeContentClient(db, viewer(designer), null)).toBe(false);
  });

  it("bulk moves drop posts the person may not see", async () => {
    expect((await visibleContentIds(db, viewer(designer), [hbPost, acePost, ownPost])).sort()).toEqual([hbPost]);
  });

  it("files on posts and brand kits follow the same rule", async () => {
    expect(await authorizeOwner(db, actor(designer), "CONTENT", hbPost, "read")).toBe(true);
    expect(await authorizeOwner(db, actor(designer), "CONTENT", acePost, "read")).toBe(false);
    expect(await authorizeOwner(db, actor(designer), "BRAND", hb, "read")).toBe(true);
    expect(await authorizeOwner(db, actor(designer), "BRAND", ace, "read")).toBe(false);
    expect(await authorizeOwner(db, actor(designer), "BRAND", "OWN", "read")).toBe(false);
    expect(await authorizeOwner(db, actor(boss, ["content.view", "projects.view_all"]), "BRAND", "OWN", "read")).toBe(true);
  });

  it("the calendar feed lists only the person's clients", async () => {
    await db.contentItem.updateMany({ where: { organizationId: org }, data: { status: "APPROVED", plannedDate: new Date().toISOString().slice(0, 10) } });
    const role = await db.role.create({ data: { organizationId: org, key: "GD_TEST", name: "Designer test" } });
    const perm = await db.permission.upsert({ where: { key: "content.view" }, update: {}, create: { key: "content.view", description: "View the content calendar" } });
    await db.rolePermission.create({ data: { roleId: role.id, permissionId: perm.id } });
    await db.userRole.create({ data: { userId: designer, roleId: role.id } });
    const token = "a".repeat(48);
    await db.user.update({ where: { id: designer }, data: { calendarToken: token, userType: "EMPLOYEE", active: true } });
    const titles = ((await eventsForToken(db, token)) ?? []).filter((e) => e.uid.startsWith("content-")).map((e) => e.title);
    expect(titles.some((t) => t.includes("HB post"))).toBe(true);
    expect(titles.some((t) => t.includes("Ace post for Huzaifa"))).toBe(true);
    expect(titles.some((t) => t.endsWith("Ace post") || t.includes("Our own post"))).toBe(false);
  });
});
