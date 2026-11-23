import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { runTaskDeadlineAlerts } from "./task-clock";
import { changeTaskStatus } from "./tasks";
import { taskAssigned } from "./events";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
let org: string, otherOrg: string, pm: string, dev: string, outsider: string, project: string, otherProject: string;
const inbox = (id: string) => db.notification.findMany({ where: { userId: id }, orderBy: { createdAt: "asc" } });
// 24 Nov 2026, 6:30 PM in Karachi = 13:30 UTC
const DUE = new Date("2026-11-24T00:00:00.000Z");
const DEADLINE = new Date("2026-11-24T13:30:00.000Z");
const at = (minutesBefore: number) => new Date(DEADLINE.getTime() - minutesBefore * 60_000);

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "Notification","Task","ProjectMember","Project","WorkingCalendar","User","CompanyProfile","Organization" CASCADE');
  org = (await db.organization.create({ data: { name: "Clock Org" } })).id;
  otherOrg = (await db.organization.create({ data: { name: "Other Org" } })).id;
  await db.companyProfile.create({ data: { organizationId: org, isDefault: true, legalName: "Clock Org", timezone: "Asia/Karachi" } });
  pm = (await db.user.create({ data: { organizationId: org, email: "pm@c.test", name: "Pia PM", passwordHash: "x" } })).id;
  dev = (await db.user.create({ data: { organizationId: org, email: "dev@c.test", name: "Dev Doe", passwordHash: "x" } })).id;
  outsider = (await db.user.create({ data: { organizationId: otherOrg, email: "o@c.test", name: "Other", passwordHash: "x" } })).id;
  project = (await db.project.create({ data: { organizationId: org, number: "P1", name: "Site", managerId: pm } })).id;
  otherProject = (await db.project.create({ data: { organizationId: otherOrg, number: "P1", name: "Theirs", managerId: outsider } })).id;
});
afterAll(async () => { await db.$disconnect(); });

describe("task deadline alerts", () => {
  it("tells the assignee 2 hours before, once, and nothing earlier", async () => {
    await db.task.create({ data: { projectId: project, title: "Banner set", assigneeId: dev, dueDate: DUE } });
    expect(await runTaskDeadlineAlerts(db, { now: at(180), organizationId: org })).toEqual({ soon: 0, late: 0 });
    await runTaskDeadlineAlerts(db, { now: at(119), organizationId: org });
    await runTaskDeadlineAlerts(db, { now: at(60), organizationId: org });
    const mine = await inbox(dev);
    expect(mine.map((n) => n.title)).toEqual(["1 h 59 m left: Banner set"]);
    expect(mine[0].body).toBe("Site · due Today 6:30 PM");
    expect(await inbox(pm)).toHaveLength(0);
  });

  it("at the deadline tells the assignee time is up and alerts the project manager, once", async () => {
    await runTaskDeadlineAlerts(db, { now: at(-1), organizationId: org });
    await runTaskDeadlineAlerts(db, { now: at(-20), organizationId: org });
    expect((await inbox(dev)).map((n) => n.kind)).toEqual(["task.due_soon", "task.overdue"]);
    const pmBox = await inbox(pm);
    expect(pmBox.map((n) => n.title)).toEqual(["Late: Banner set"]);
    expect(pmBox[0].body).toBe("Dev Doe · Site · overdue 1 m");
  });

  it("uses the task's own time of day, and alerts again when the deadline moves", async () => {
    const t = await db.task.create({ data: { projectId: project, title: "Call script", assigneeId: dev, dueDate: DUE, dueTime: "15:00" } }); // 10:00 UTC
    await runTaskDeadlineAlerts(db, { now: new Date("2026-11-24T08:30:00.000Z"), organizationId: org });
    expect((await inbox(dev)).at(-1)?.title).toBe("1 h 30 m left: Call script");
    await db.task.update({ where: { id: t.id }, data: { dueTime: "17:00" } });
    await runTaskDeadlineAlerts(db, { now: new Date("2026-11-24T10:30:00.000Z"), organizationId: org });
    expect((await inbox(dev)).filter((n) => n.title.endsWith("Call script")).map((n) => n.title)).toEqual(["1 h 30 m left: Call script", "1 h 30 m left: Call script"]);
  });

  it("skips finished tasks, unassigned tasks, closed projects and tasks more than a day late", async () => {
    await db.task.create({ data: { projectId: project, title: "Done one", assigneeId: dev, dueDate: DUE, status: "DONE" } });
    await db.task.create({ data: { projectId: project, title: "Nobody's", dueDate: DUE } });
    const closed = (await db.project.create({ data: { organizationId: org, number: "P2", name: "Old", managerId: pm, status: "COMPLETED" } })).id;
    await db.task.create({ data: { projectId: closed, title: "Closed one", assigneeId: dev, dueDate: DUE } });
    await db.task.create({ data: { projectId: project, title: "Ancient", assigneeId: dev, dueDate: new Date("2026-11-22T00:00:00.000Z") } });
    await runTaskDeadlineAlerts(db, { now: at(-30), organizationId: org });
    const after = [...(await inbox(dev)), ...(await inbox(pm))];
    expect(after.some((n) => /Done one|Nobody|Closed one|Ancient/.test(n.title))).toBe(false);
  });

  it("does not tell the manager about their own late task, and keeps organizations apart", async () => {
    await db.task.create({ data: { projectId: project, title: "PM's own", assigneeId: pm, dueDate: DUE } });
    await db.task.create({ data: { projectId: otherProject, title: "Theirs late", assigneeId: outsider, dueDate: DUE } });
    await runTaskDeadlineAlerts(db, { now: at(-5), organizationId: org });
    expect((await inbox(pm)).filter((n) => n.title.includes("PM's own")).map((n) => n.kind)).toEqual(["task.overdue"]);
    expect(await inbox(outsider)).toHaveLength(0);
  });
});

describe("assigned and started times", () => {
  it("records when a task was assigned and when work first started", async () => {
    const t = await db.task.create({ data: { projectId: project, title: "Times", assigneeId: dev, dueDate: DUE } });
    await taskAssigned(db, { organizationId: org, taskId: t.id, toUserId: dev, byUserId: pm });
    const assigned = await db.task.findUniqueOrThrow({ where: { id: t.id } });
    expect(assigned.assignedAt).not.toBeNull();
    const first = new Date("2026-11-24T06:00:00.000Z");
    await changeTaskStatus(db, { projectId: project, taskId: t.id, status: "IN_PROGRESS", actorId: dev, now: first });
    await changeTaskStatus(db, { projectId: project, taskId: t.id, status: "REVIEW", actorId: dev, now: new Date("2026-11-24T07:00:00.000Z") });
    await changeTaskStatus(db, { projectId: project, taskId: t.id, status: "IN_PROGRESS", actorId: dev, now: new Date("2026-11-24T08:00:00.000Z") });
    expect((await db.task.findUniqueOrThrow({ where: { id: t.id } })).startedAt?.toISOString()).toBe(first.toISOString());
  });

  it("does not record an assignment from another organization", async () => {
    const t = await db.task.create({ data: { projectId: project, title: "Guarded", assigneeId: dev } });
    await taskAssigned(db, { organizationId: otherOrg, taskId: t.id, toUserId: dev, byUserId: outsider });
    expect((await db.task.findUniqueOrThrow({ where: { id: t.id } })).assignedAt).toBeNull();
  });
});
