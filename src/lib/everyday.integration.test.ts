import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { eventsForToken, newToken, renderIcs, setCalendarToken } from "./calendar";
import { OrgError, addBranch, addDepartment, assignPerson, deleteDepartment, renameDepartment, updateBranch } from "./org-structure";
import { searchAll } from "./search";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
let org: string, other: string, ann: string, bob: string, clientAcme: string;
const day = (n: number) => new Date(Date.now() + n * 86400000);
const iso = (d: Date) => d.toISOString().slice(0, 10);

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "ContentItem","Contract","Task","ProjectMember","Project","LeaveRequest","LeaveType","Lead","PipelineStage","Invoice","Client","EmployeeProfile","UserRole","RolePermission","Role","Permission","User","Branch","Department","Organization" CASCADE');
  org = (await db.organization.create({ data: { name: "Everyday Org" } })).id;
  other = (await db.organization.create({ data: { name: "Other Org" } })).id;
  ann = (await db.user.create({ data: { organizationId: org, email: "ann@e.test", name: "Ann Agent", passwordHash: "x" } })).id;
  bob = (await db.user.create({ data: { organizationId: org, email: "bob@e.test", name: "Bob Boss", passwordHash: "x" } })).id;
  clientAcme = (await db.client.create({ data: { organizationId: org, name: "Acme Trading", email: "hello@acme.test", currency: "USD" } })).id;
  await db.client.create({ data: { organizationId: other, name: "Acme Secret Rival", currency: "USD" } });
  const stage = await db.pipelineStage.create({ data: { organizationId: org, name: "New", sortOrder: 1 } });
  await db.lead.create({ data: { organizationId: org, stageId: stage.id, name: "Acme prospect (Ann)", assignedToId: ann, nextFollowUp: day(3) } });
  await db.lead.create({ data: { organizationId: org, stageId: stage.id, name: "Acme prospect (Bob)", assignedToId: bob } });
  await db.project.create({ data: { organizationId: org, number: "PRJ-1", name: "Acme website", managerId: bob, currency: "USD", deadline: day(10), members: { create: [{ userId: bob }] } } });
});
afterAll(async () => { await db.$disconnect(); });

describe("search", () => {
  const who = (id: string, ...perms: string[]) => ({ id, organizationId: org, permissions: new Set(perms) });
  it("returns nothing for short queries and for people with no viewing rights", async () => {
    expect(await searchAll(db, who(bob, "clients.view"), "a")).toEqual([]);
    expect(await searchAll(db, who(bob), "Acme")).toEqual([]);
  });
  it("only searches the groups the person may view, inside their own organization", async () => {
    const g = await searchAll(db, who(bob, "clients.view"), "acme");
    expect(g.map((x) => x.title)).toEqual(["Clients"]);
    expect(g[0].hits.map((h) => h.label)).toEqual(["Acme Trading"]); // not the other organization's client
    expect(g[0].hits[0].href).toBe(`/clients/${clientAcme}`);
  });
  it("agents find only their own leads, managers find all", async () => {
    const agent = await searchAll(db, who(ann, "crm.view"), "prospect");
    expect(agent[0].hits.map((h) => h.label)).toEqual(["Acme prospect (Ann)"]);
    const boss = await searchAll(db, who(bob, "crm.view", "crm.view_all"), "prospect");
    expect(boss[0].hits).toHaveLength(2);
  });
  it("project members find only projects they belong to", async () => {
    expect(await searchAll(db, who(ann, "projects.view"), "website")).toEqual([]);
    expect((await searchAll(db, who(bob, "projects.view"), "website"))[0].hits[0].sub).toContain("PRJ-1");
  });
  it("treats percent signs and underscores as ordinary characters", async () => {
    expect(await searchAll(db, who(bob, "clients.view"), "%%")).toEqual([]);
    await db.client.create({ data: { organizationId: org, name: "50%_Off Discount Co", currency: "USD" } });
    expect((await searchAll(db, who(bob, "clients.view"), "50%_off"))[0].hits.map((h) => h.label)).toEqual(["50%_Off Discount Co"]);
    expect(await searchAll(db, who(bob, "clients.view"), "50_off")).toEqual([]);
    expect(await searchAll(db, who(bob, "clients.view"), "ac\\me")).toEqual([]);
  });
});

describe("offices and departments", () => {
  it("adds branches with validation, unique names and valid time zones", async () => {
    await expect(addBranch(db, { organizationId: org, name: " ", kind: "OFFICE" })).rejects.toThrow(OrgError);
    await expect(addBranch(db, { organizationId: org, name: "X", kind: "CASTLE" })).rejects.toThrow(OrgError);
    await expect(addBranch(db, { organizationId: org, name: "X", kind: "OFFICE", timezone: "Mars/Olympus" })).rejects.toThrow(/time zone/);
    const b = await addBranch(db, { organizationId: org, name: "Islamabad Sales Centre", kind: "SALES_CENTRE", timezone: "Asia/Karachi" });
    await expect(addBranch(db, { organizationId: org, name: "Islamabad Sales Centre", kind: "OFFICE" })).rejects.toThrow(/already exists/);
    await updateBranch(db, { organizationId: org, branchId: b.id, name: "Islamabad Centre", kind: "SALES_CENTRE", timezone: "Asia/Karachi", active: false });
    expect((await db.branch.findUniqueOrThrow({ where: { id: b.id } })).active).toBe(false);
    await expect(updateBranch(db, { organizationId: other, branchId: b.id, name: "Hijack", kind: "OFFICE", active: true })).rejects.toThrow(/not found/);
  });

  it("manages departments and refuses to delete one with people in it", async () => {
    const d = await addDepartment(db, { organizationId: org, name: "Design" });
    await expect(addDepartment(db, { organizationId: org, name: "Design" })).rejects.toThrow(/already exists/);
    await renameDepartment(db, { organizationId: org, departmentId: d.id, name: "Creative" });
    const b = await addBranch(db, { organizationId: org, name: "HQ", kind: "REGISTERED_OFFICE" });
    await assignPerson(db, { organizationId: org, userId: ann, branchId: b.id, departmentId: d.id });
    expect((await db.user.findUniqueOrThrow({ where: { id: ann } })).departmentId).toBe(d.id);
    await expect(deleteDepartment(db, { organizationId: org, departmentId: d.id })).rejects.toThrow(/Move them first/);
    await assignPerson(db, { organizationId: org, userId: ann, branchId: null, departmentId: null });
    await deleteDepartment(db, { organizationId: org, departmentId: d.id });
    expect(await db.department.count({ where: { id: d.id } })).toBe(0);
  });

  it("will not assign across organizations or to an archived branch", async () => {
    const d = await addDepartment(db, { organizationId: other, name: "Foreign" });
    await expect(assignPerson(db, { organizationId: org, userId: ann, branchId: null, departmentId: d.id })).rejects.toThrow(OrgError);
    const archived = await db.branch.findFirstOrThrow({ where: { organizationId: org, active: false } });
    await expect(assignPerson(db, { organizationId: org, userId: ann, branchId: archived.id, departmentId: null })).rejects.toThrow(/active branch/);
  });
});

describe("calendar feed", () => {
  it("rejects unknown, malformed, switched-off and inactive tokens the same way", async () => {
    expect(await eventsForToken(db, "nope")).toBeNull();
    expect(await eventsForToken(db, newToken())).toBeNull();
    const t = (await setCalendarToken(db, ann, "create"))!;
    expect(await eventsForToken(db, t)).not.toBeNull();
    await setCalendarToken(db, ann, "off");
    expect(await eventsForToken(db, t)).toBeNull();
    const t2 = (await setCalendarToken(db, ann, "create"))!;
    await db.user.update({ where: { id: ann }, data: { active: false } });
    expect(await eventsForToken(db, t2)).toBeNull();
    await db.user.update({ where: { id: ann }, data: { active: true } });
  });

  it("replacing the address makes the old one stop working", async () => {
    const a = (await setCalendarToken(db, bob, "create"))!;
    const b = (await setCalendarToken(db, bob, "rotate"))!;
    expect(a).not.toBe(b);
    expect(await eventsForToken(db, a)).toBeNull();
    expect(await eventsForToken(db, b)).not.toBeNull();
  });

  it("contains a person's own items, and restricted dates only when their role allows", async () => {
    const t = (await setCalendarToken(db, ann, "create"))!;
    const none = (await eventsForToken(db, t))!;
    expect(none.map((e) => e.title)).toEqual([]); // no permissions in the test database, so no follow-ups either
    const proj = await db.project.findFirstOrThrow({ where: { organizationId: org } });
    await db.task.create({ data: { projectId: proj.id, title: "Draft the brief", assigneeId: ann, dueDate: day(2) } });
    await db.task.create({ data: { projectId: proj.id, title: "Someone else's task", assigneeId: bob, dueDate: day(2) } });
    await db.task.create({ data: { projectId: proj.id, title: "Finished task", assigneeId: ann, dueDate: day(2), status: "DONE" } });
    const ev = (await eventsForToken(db, t))!;
    expect(ev.map((e) => e.title)).toEqual(["Task due: Draft the brief"]);
    expect(ev[0].date).toBe(iso(day(2)));
  });

  it("renders valid iCalendar text: escaped, folded, CRLF, all-day events ending the next day", () => {
    const ics = renderIcs([{ uid: "t-1", date: "2026-12-31", title: "Review; plan, and \\ ship\nnow", description: "x".repeat(200) }], "Hifi One", new Date("2026-10-11T08:00:00Z"));
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("DTSTART;VALUE=DATE:20261231");
    expect(ics).toContain("DTEND;VALUE=DATE:20270101");
    expect(ics).toContain("SUMMARY:Review\\; plan\\, and \\\\ ship\\nnow");
    expect(ics.split("\r\n").every((l) => Buffer.byteLength(l) <= 75)).toBe(true);
    expect(ics).toContain("UID:t-1@hifi-one");
  });
});
