// Weekly project emails against hifi_one_test: owners get every active project's health; each client gets only their own
// projects and only the tasks shared with them; people without the owner permissions get nothing; a second run in the same
// week sends nothing more.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { clientDigest, listed, ownerDigest, sendWeeklyDigests, weekWindow } from "./weekly-digest";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
const today = "2026-11-16"; // a Monday
const at = (iso: string) => new Date(`${iso}T10:00:00Z`);
let org: string, owner: string, designer: string, foodCo: string, shoeCo: string, food: string, shoe: string, foodPortal: string;

const role = async (key: string, perms: string[]) => {
  const r = await db.role.create({ data: { organizationId: org, key, name: key } });
  for (const k of perms) {
    const p = await db.permission.upsert({ where: { key: k }, update: {}, create: { key: k, description: k } });
    await db.rolePermission.create({ data: { roleId: r.id, permissionId: p.id } });
  }
  return r.id;
};
const staff = (name: string, roleId: string | null, email: string | null = `${name}@digest.test`) => db.user.create({ data: { organizationId: org, name, email, passwordHash: "x", userType: "EMPLOYEE", ...(roleId ? { roles: { create: { roleId } } } : {}) } }).then((u) => u.id);

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "ClientRequest","Deliverable","ContentItem","EmailMessage","Notification","TaskChecklistItem","Task","ProjectUpdate","ProjectMember","Project","Client","UserRole","Role","User","Organization" CASCADE');
  org = (await db.organization.create({ data: { name: "Digest Org" } })).id;
  owner = await staff("owner", await role("OWNER", ["dashboard.executive", "projects.view_all", "projects.costs"]));
  await staff("coo", await role("COO", ["dashboard.executive", "projects.view_all"]));
  await staff("finance", await role("FIN", ["dashboard.executive"])); // can't see every project: no project email
  designer = await staff("designer", await role("DESIGN", ["projects.view"]));
  foodCo = (await db.client.create({ data: { organizationId: org, name: "Food Co", email: "hello@foodco.test", projectManagerId: designer } })).id;
  shoeCo = (await db.client.create({ data: { organizationId: org, name: "Shoe Co" } })).id; // no email: goes to its portal users
  foodPortal = (await db.user.create({ data: { organizationId: org, name: "Food portal", email: "portal@foodco.test", passwordHash: "x", userType: "CLIENT", clientId: foodCo } })).id;
  await db.user.create({ data: { organizationId: org, name: "Shoe portal", email: "portal@shoeco.test", passwordHash: "x", userType: "CLIENT", clientId: shoeCo } });

  food = (await db.project.create({ data: { organizationId: org, number: "DG-1", name: "Food social", clientId: foodCo, managerId: owner, createdAt: at("2026-10-01") } })).id;
  shoe = (await db.project.create({ data: { organizationId: org, number: "DG-2", name: "Shoe launch", clientId: shoeCo, managerId: owner, createdAt: at("2026-11-12") } })).id;
  await db.project.create({ data: { organizationId: org, number: "DG-3", name: "Old site", clientId: shoeCo, managerId: owner, status: "COMPLETED" } });
  // Food: three overdue tasks (red), one shared task finished last week, one internal task finished, one shared task coming up
  for (const i of [1, 2, 3]) await db.task.create({ data: { projectId: food, title: `late ${i}`, dueDate: at("2026-11-01") } });
  await db.task.create({ data: { projectId: food, title: "Eid reel", status: "DONE", clientVisible: true, completedAt: at("2026-11-12") } });
  await db.task.create({ data: { projectId: food, title: "Internal cost sheet", status: "DONE", completedAt: at("2026-11-13") } });
  await db.task.create({ data: { projectId: food, title: "Old done", status: "DONE", clientVisible: true, completedAt: at("2026-11-02") } }); // before last week
  await db.task.create({ data: { projectId: food, title: "Launch video", clientVisible: true, dueDate: at("2026-11-20") } });
  await db.deliverable.create({ data: { organizationId: org, projectId: food, title: "Logo options", status: "PENDING", createdById: owner } });
  await db.clientRequest.create({ data: { organizationId: org, projectId: food, clientId: foodCo, createdById: foodPortal, title: "Add Eid offer", status: "PENDING" } });
  await db.projectUpdate.create({ data: { organizationId: org, projectId: shoe, title: "Kick-off", authorId: owner, createdAt: at("2026-11-13") } });
});
afterAll(async () => { await db.$disconnect(); });

describe("weekly project emails", () => {
  it("covers the seven days before Monday", () => {
    expect(weekWindow(today)).toMatchObject({ from: "2026-11-09", to: "2026-11-15", label: "9 Nov to 15 Nov 2026" });
    expect(listed(["a", "b", "c", "d", "e", "f", "g"])).toBe("a; b; c; d; e; and 2 more");
  });

  it("gives the owner every active project's health and last week's numbers", async () => {
    const d = await ownerDigest(db, { organizationId: org, today, withBudget: true });
    expect(d).toMatchObject({ active: 2, atRisk: ["Food social (3 tasks overdue)"], watch: [], onTrack: 1, finished: 2, overdue: 3, requests: 1, approvals: 1 });
  });

  it("tells a client only about their own projects and only the tasks shared with them", async () => {
    const d = await clientDigest(db, { organizationId: org, clientId: foodCo, today });
    expect(d).toMatchObject({ clientName: "Food Co", clientEmail: "hello@foodco.test", projectManager: "designer", finished: ["Eid reel"], next: ["Launch video due 20 Nov"], waiting: "1 deliverable to approve", requests: "1 waiting" });
    expect(d!.progress).toEqual(["Food social: 43% done"]); // 3 of 7 tasks, as the portal counts
    expect(JSON.stringify(d)).not.toContain("Internal cost sheet");
    expect(JSON.stringify(d)).not.toContain("Shoe");
  });

  it("emails owners and clients once a week, and nobody without the owner permissions", async () => {
    const r = await sendWeeklyDigests(db, { organizationId: org, today });
    expect(r).toMatchObject({ owners: 2, clients: 2 });
    const mails = await db.emailMessage.findMany({ where: { relatedType: "WeeklyDigest" }, select: { toEmail: true, subject: true } });
    expect(mails.map((m) => m.toEmail).sort()).toEqual(["coo@digest.test", "hello@foodco.test", "owner@digest.test", "portal@shoeco.test"]);
    expect(mails.find((m) => m.toEmail === "owner@digest.test")?.subject).toBe("Your projects this week: 1 at risk");
    expect(await db.notification.count({ where: { kind: "project.weekly", userId: designer } })).toBe(0);
    expect(await db.notification.count({ where: { kind: "portal.weekly", userId: foodPortal } })).toBe(1);

    expect(await sendWeeklyDigests(db, { organizationId: org, today })).toMatchObject({ owners: 0, clients: 0 });
    expect(await db.emailMessage.count({ where: { relatedType: "WeeklyDigest" } })).toBe(4);
  });
});
