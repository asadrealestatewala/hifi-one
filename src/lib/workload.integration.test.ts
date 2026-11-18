// loadWorkload against hifi_one_test: per-person load over the next 7 days, only from projects in scope.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { loadWorkload } from "./workload";
import { calendarFrom } from "./working-calendar";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
const TODAY = "2026-11-18";
const CAL = calendarFrom({ workStart: "09:00", workEnd: "18:30", lunchMinutes: 30, graceMinutes: 10, workDays: "1,2,3,4,5" }, "Asia/Karachi"); // 9 h days, Mon–Fri
const d = (s: string) => new Date(`${s}T00:00:00Z`);

let org: string, boss: string, busy: string, free: string, away: string, mine: string, other: string;

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "LeaveRequest","LeaveType","TimeEntry","Task","ProjectMember","Project","User","Organization" CASCADE');
  org = (await db.organization.create({ data: { name: "Load Org" } })).id;
  const mk = (name: string) => db.user.create({ data: { organizationId: org, name, email: `${name}@load.test`, passwordHash: "x", userType: "EMPLOYEE" } }).then((u) => u.id);
  boss = await mk("boss"); busy = await mk("busy"); free = await mk("free"); away = await mk("away");
  mine = (await db.project.create({ data: { organizationId: org, number: "L-1", name: "Mine", managerId: boss, members: { create: [{ userId: boss }, { userId: busy }, { userId: free }, { userId: away }] } } })).id;
  other = (await db.project.create({ data: { organizationId: org, number: "L-2", name: "Not mine", managerId: free, members: { create: [{ userId: free }, { userId: busy }] } } })).id;
  const t = (projectId: string, assigneeId: string | null, over: Record<string, unknown> = {}) => db.task.create({ data: { projectId, title: "t", assigneeId, ...over } });
  await t(mine, busy, { dueDate: d("2026-11-10"), estimatedHours: "20" }); // overdue counts toward the load
  await t(mine, busy, { dueDate: d("2026-11-20"), estimatedHours: "30" });
  await t(mine, busy, { dueDate: d("2026-11-21") }); // no estimate
  await t(mine, busy, { dueDate: d("2026-12-20"), estimatedHours: "99" }); // outside the window
  await t(mine, busy, { dueDate: d("2026-11-19"), estimatedHours: "8", status: "DONE" });
  await t(mine, free, { dueDate: d("2026-11-19"), estimatedHours: "4" });
  await t(mine, away, { dueDate: d("2026-11-19"), estimatedHours: "2" });
  await t(mine, null, { dueDate: d("2026-11-19") });
  await t(other, busy, { dueDate: d("2026-11-19"), estimatedHours: "50" }); // a project boss does not run
  const lt = await db.leaveType.create({ data: { organizationId: org, name: "Annual", daysPerYear: "14" } });
  await db.leaveRequest.create({ data: { userId: away, leaveTypeId: lt.id, startDate: "2026-11-16", endDate: "2026-11-30", days: "11", status: "APPROVED" } });
  await db.timeEntry.create({ data: { organizationId: org, projectId: mine, userId: busy, workDate: "2026-11-17", hours: "6.5" } });
  await db.timeEntry.create({ data: { organizationId: org, projectId: mine, userId: busy, workDate: "2026-11-14", hours: "8" } }); // last week
});
afterAll(async () => { await db.$disconnect(); });

describe("loadWorkload", () => {
  it("measures each person's next 7 days against their working hours, in the manager's projects only", async () => {
    const wl = await loadWorkload(db, { scope: { organizationId: org, managerId: boss }, organizationId: org, today: TODAY, calendar: CAL, holidays: [] });
    const by = Object.fromEntries(wl.people.map((p) => [p.name, p]));
    expect(by.busy).toMatchObject({ open: 4, overdue: 1, dueInWindow: 2, plannedHours: 50, unestimated: 1, capacityHours: 45, loggedHours: 6.5, level: "OVER", percent: 111 });
    expect(by.free).toMatchObject({ open: 1, plannedHours: 4, level: "OK" });
    expect(wl.unassigned).toBe(1);
    expect(wl.people[0].name).toBe("busy"); // the most overloaded comes first
    expect(wl.window).toEqual({ from: "2026-11-18", to: "2026-11-24" });
  });

  it("treats approved leave as no available hours", async () => {
    const wl = await loadWorkload(db, { scope: { organizationId: org, managerId: boss }, organizationId: org, today: TODAY, calendar: CAL, holidays: [] });
    const a = wl.people.find((p) => p.name === "away")!;
    expect(a.capacityHours).toBe(0);
    expect(a.level).toBe("OVER"); // a task is due while they are away
  });

  it("shows nobody and nothing from projects outside the scope", async () => {
    const wl = await loadWorkload(db, { scope: { organizationId: org, managerId: busy }, organizationId: org, today: TODAY, calendar: CAL, holidays: [] });
    expect(wl.people).toEqual([]);
    expect(wl.unassigned).toBe(0);
  });
});
