// Portfolio health against hifi_one_test: counts come from the project's real tasks and updates; budget is left out for
// people who may not see costs; closed projects get no health.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient, Prisma } from "@prisma/client";
import { loadProjectHealth } from "./project-health";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
let org: string, pm: string;
let n = 0;
const select = { id: true, status: true, deadline: true, createdAt: true, budgetAmount: true } as const;
const project = (data: Partial<Prisma.ProjectUncheckedCreateInput> = {}) => db.project.create({ data: { organizationId: org, number: `PH-${++n}`, name: `Health ${n}`, managerId: pm, ...data }, select });
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "ProjectUpdate","TaskChecklistItem","Task","ProjectMember","Project","User","Organization" CASCADE');
  org = (await db.organization.create({ data: { name: "Health Org" } })).id;
  pm = (await db.user.create({ data: { organizationId: org, email: "pm@health.test", name: "PM", passwordHash: "x", userType: "EMPLOYEE" } })).id;
});
afterAll(async () => { await db.$disconnect(); });

describe("loadProjectHealth", () => {
  it("reads overdue tasks, progress and the last update from the database", async () => {
    const late = await project({ deadline: day("2026-12-31"), createdAt: day("2026-10-01") });
    for (const [i, due] of ["2026-11-01", "2026-11-02", "2026-11-03"].entries()) await db.task.create({ data: { projectId: late.id, title: `late ${i}`, dueDate: day(due) } });
    await db.task.create({ data: { projectId: late.id, title: "due today", dueDate: day("2026-11-18") } }); // not overdue yet
    await db.task.create({ data: { projectId: late.id, title: "done", status: "DONE", dueDate: day("2026-11-01") } }); // finished work never counts
    await db.projectUpdate.create({ data: { organizationId: org, projectId: late.id, title: "Week 1", authorId: pm, createdAt: day("2026-11-16") } });

    const fine = await project({ createdAt: day("2026-11-15") });
    const paused = await project({ status: "ON_HOLD" });
    const closed = await project({ status: "COMPLETED" });
    const m = await loadProjectHealth(db, { organizationId: org, projects: [late, fine, paused, closed], today: "2026-11-18", withBudget: false });

    expect(m.get(late.id)).toMatchObject({ health: "RED", reasons: ["3 tasks overdue"], overdueTasks: 3, lastUpdate: "2026-11-16" });
    expect(m.get(fine.id)).toMatchObject({ health: "GREEN", reasons: [] });
    expect(m.get(paused.id)?.health).toBe("PAUSED");
    expect(m.has(closed.id)).toBe(false);
  });

  it("leaves budget out for people without cost rights", async () => {
    const p = await project({ budgetAmount: new Prisma.Decimal(1000), createdAt: day("2026-11-15") });
    expect((await loadProjectHealth(db, { organizationId: org, projects: [p], today: "2026-11-18", withBudget: false })).get(p.id)?.budgetUsedPct).toBeNull();
    expect((await loadProjectHealth(db, { organizationId: org, projects: [p], today: "2026-11-18", withBudget: true })).get(p.id)).toMatchObject({ health: "GREEN", budgetUsedPct: 0 });
  });

  it("returns nothing for an empty list", async () => {
    expect((await loadProjectHealth(db, { organizationId: org, projects: [], today: "2026-11-18", withBudget: true })).size).toBe(0);
  });
});
