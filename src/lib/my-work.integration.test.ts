// loadMyWork against hifi_one_test: one person's open tasks grouped by due date, and nobody else's.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { loadMyWork, workGroupOf } from "./my-work";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
const TZ = "Asia/Karachi";
const TODAY = "2026-11-18";
const day = (n: number) => new Date(Date.UTC(2026, 10, 18 + n));

let org: string, other: string, me: string, colleague: string, project: string, cancelled: string, foreign: string;

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "Task","Project","User","Organization" CASCADE');
  org = (await db.organization.create({ data: { name: "Work Org" } })).id;
  other = (await db.organization.create({ data: { name: "Other Org" } })).id;
  me = (await db.user.create({ data: { organizationId: org, name: "Me", email: "me@w.example", passwordHash: "x", userType: "EMPLOYEE" } })).id;
  colleague = (await db.user.create({ data: { organizationId: org, name: "Colleague", email: "c@w.example", passwordHash: "x", userType: "EMPLOYEE" } })).id;
  const mk = async (organizationId: string, number: string, status = "ACTIVE") => (await db.project.create({ data: { organizationId, name: `P ${number}`, number, managerId: me, status: status as "ACTIVE" } })).id;
  project = await mk(org, "PRJ-1");
  cancelled = await mk(org, "PRJ-2", "CANCELLED");
  foreign = await mk(other, "PRJ-3");
  const t = (title: string, over: Record<string, unknown> = {}) => db.task.create({ data: { projectId: project, title, assigneeId: me, ...over } });
  await t("late", { dueDate: day(-2) });
  await t("today", { dueDate: day(0), priority: "HIGH" });
  await t("soon", { dueDate: day(3) });
  await t("later", { dueDate: day(10) });
  const parent = await t("parent, no date");
  await t("my subtask", { parentId: parent.id, dueDate: day(0) });
  await db.task.create({ data: { projectId: project, title: "open sub of parent", parentId: parent.id, assigneeId: colleague } });
  const blocker = await db.task.create({ data: { projectId: project, title: "blocker", assigneeId: colleague } });
  await t("waits", { dueDate: day(1), blockedBy: [blocker.id] });
  await t("done today", { status: "DONE", completedAt: new Date("2026-11-18T06:00:00Z") });
  await t("done yesterday", { status: "DONE", completedAt: new Date("2026-11-17T06:00:00Z") });
  await db.task.create({ data: { projectId: project, title: "colleague's", assigneeId: colleague, dueDate: day(0) } });
  await db.task.create({ data: { projectId: cancelled, title: "in cancelled project", assigneeId: me, dueDate: day(0) } });
  await db.task.create({ data: { projectId: foreign, title: "other org", assigneeId: me, dueDate: day(0) } });
});

afterAll(async () => { await db.$disconnect(); });

const load = (over: Partial<Parameters<typeof loadMyWork>[1]> = {}) => loadMyWork(db, { organizationId: org, userId: me, today: TODAY, timeZone: TZ, ...over });
const titles = (r: Awaited<ReturnType<typeof load>>, k: string) => r.sections.find((s) => s.key === k)!.rows.map((x) => x.title).sort();

describe("loadMyWork", () => {
  it("groups my open tasks, subtasks included, by due date", async () => {
    const r = await load();
    expect(titles(r, "overdue")).toEqual(["late"]);
    expect(titles(r, "today")).toEqual(["my subtask", "today"]);
    expect(titles(r, "week")).toEqual(["soon", "waits"]);
    expect(titles(r, "later")).toEqual(["later"]);
    expect(titles(r, "nodate")).toEqual(["parent, no date"]);
    expect(titles(r, "done")).toEqual(["done today"]);
    expect(r.open).toBe(7);
    for (const s of r.sections) for (const row of s.rows) if (s.key !== "done") expect(workGroupOf(row.dueDate, TODAY)).toBe(s.key);
  });

  it("never shows a colleague's task, a cancelled project's or another organization's", async () => {
    const all = (await load()).sections.flatMap((s) => s.rows.map((x) => x.title));
    expect(all).not.toContain("colleague's");
    expect(all).not.toContain("in cancelled project");
    expect(all).not.toContain("other org");
    const colleagueView = await loadMyWork(db, { organizationId: org, userId: colleague, today: TODAY, timeZone: TZ });
    expect(colleagueView.sections.flatMap((s) => s.rows.map((x) => x.title))).not.toContain("late");
    const wrongOrg = await loadMyWork(db, { organizationId: other, userId: me, today: TODAY, timeZone: TZ });
    expect(wrongOrg.open).toBe(1); // only the task in the other organization's project
  });

  it("says what a row waits for, whose subtask it is and how many subtasks are open", async () => {
    const r = await load();
    const rows = r.sections.flatMap((s) => s.rows);
    expect(rows.find((x) => x.title === "waits")!.waiting).toBe(1);
    expect(rows.find((x) => x.title === "my subtask")!.parentTitle).toBe("parent, no date");
    expect(rows.find((x) => x.title === "parent, no date")!.openSubtasks).toBe(2);
  });

  it("caps each group and pages one group in full", async () => {
    const r = await load({ perGroup: 1 });
    const today = r.sections.find((s) => s.key === "today")!;
    expect(today.rows).toHaveLength(1);
    expect(today.count).toBe(2);
    const p2 = await load({ only: { group: "today", skip: 1, take: 1 } });
    expect(p2.sections).toHaveLength(1);
    expect(p2.sections[0].rows).toHaveLength(1);
    expect(p2.sections[0].rows[0].id).not.toBe(today.rows[0].id);
  });
});
