// Team hours report against hifi_one_test: periods, working hours with holidays and leave, planned and logged hours, client and
// internal split, utilisation to date, and the project manager's narrower scope.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { loadHoursReport, periodRange } from "./hours-report";
import { calendarFrom } from "./working-calendar";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
const d = (s: string) => new Date(`${s}T00:00:00Z`);
const CAL = calendarFrom({ workStart: "09:00", workEnd: "18:30", lunchMinutes: 30, graceMinutes: 10, workDays: "1,2,3,4,5" }, "Asia/Karachi"); // 9 h days, Mon–Fri

let org: string, boss: string, ana: string, ali: string, left: string, clientProj: string, internal: string, notMine: string;

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "LeaveRequest","LeaveType","TimeEntry","Task","ProjectMember","Project","Client","User","Organization" CASCADE');
  org = (await db.organization.create({ data: { name: "Hours Org" } })).id;
  const client = (await db.client.create({ data: { organizationId: org, name: "Acme", currency: "PKR" } })).id;
  const mk = (name: string) => db.user.create({ data: { organizationId: org, name, email: `${name}@hours.test`, passwordHash: "x", userType: "EMPLOYEE" } }).then((u) => u.id);
  boss = await mk("boss"); ana = await mk("ana"); ali = await mk("ali"); left = await mk("left");
  clientProj = (await db.project.create({ data: { organizationId: org, number: "H-1", name: "Client site", clientId: client, managerId: boss, members: { create: [{ userId: boss }, { userId: ana }, { userId: ali }] } } })).id;
  internal = (await db.project.create({ data: { organizationId: org, number: "H-2", name: "Our website", managerId: boss, members: { create: [{ userId: ana }] } } })).id;
  notMine = (await db.project.create({ data: { organizationId: org, number: "H-3", name: "Other", clientId: client, managerId: ali, members: { create: [{ userId: ana }] } } })).id;
  const te = (projectId: string, userId: string, workDate: string, hours: string, approval = "APPROVED") => db.timeEntry.create({ data: { organizationId: org, projectId, userId, workDate, hours, approval } });
  await te(clientProj, ana, "2026-11-03", "6");
  await te(internal, ana, "2026-11-04", "2.5", "PENDING");
  await te(notMine, ana, "2026-11-05", "4");
  await te(clientProj, ana, "2026-10-31", "9"); // October
  await te(clientProj, left, "2026-11-02", "3"); // someone who has since left still shows for the hours they logged
  await db.user.update({ where: { id: left }, data: { active: false } });
  await db.task.create({ data: { projectId: clientProj, title: "Plan", assigneeId: ana, dueDate: d("2026-11-20"), estimatedHours: "10" } });
  await db.task.create({ data: { projectId: internal, title: "Done one", assigneeId: ana, dueDate: d("2026-11-06"), estimatedHours: "3", status: "DONE" } });
  await db.task.create({ data: { projectId: clientProj, title: "No size", assigneeId: ana, dueDate: d("2026-11-07") } });
  await db.task.create({ data: { projectId: clientProj, title: "December", assigneeId: ana, dueDate: d("2026-12-02"), estimatedHours: "40" } });
  const lt = await db.leaveType.create({ data: { organizationId: org, name: "Annual", daysPerYear: "14" } });
  await db.leaveRequest.create({ data: { userId: ali, leaveTypeId: lt.id, startDate: "2026-11-02", endDate: "2026-11-06", days: "5", status: "APPROVED" } });
});
afterAll(async () => { await db.$disconnect(); });

describe("periodRange", () => {
  it("gives Monday-to-Sunday weeks and calendar months, with the neighbours", () => {
    expect(periodRange("week", "2026-11-19", "2026-11-19")).toMatchObject({ from: "2026-11-16", to: "2026-11-22", prev: "2026-11-09", next: "2026-11-23" });
    expect(periodRange("month", "2026-12-15", "2026-11-19")).toMatchObject({ from: "2026-12-01", to: "2026-12-31", label: "December 2026", prev: "2026-11-30", next: "2027-01-01" });
    expect(periodRange("month", "2028-02-10", "2026-11-19")).toMatchObject({ from: "2028-02-01", to: "2028-02-29" });
    expect(periodRange("month", "rubbish", "2026-11-19")).toMatchObject({ from: "2026-11-01", to: "2026-11-30" });
  });
});

describe("loadHoursReport", () => {
  const all = { organizationId: "" };
  it("adds up each person's month for someone who sees every project", async () => {
    const r = await loadHoursReport(db, { scope: { ...all, organizationId: org }, organizationId: org, period: "month", at: "2026-11-10", today: "2026-11-30", calendar: CAL, holidays: ["2026-11-09"] });
    const ana_ = r.rows.find((x) => x.userId === ana)!;
    // November 2026: 21 weekdays less the holiday = 20 days of 9 h
    expect(ana_).toMatchObject({ availableHours: 180, availableSoFar: 180, loggedHours: 12.5, clientHours: 10, internalHours: 2.5, pendingHours: 2.5, plannedHours: 13, unestimated: 1, utilisation: 7 });
    expect(r.rows.find((x) => x.userId === ali)).toMatchObject({ availableHours: 135, loggedHours: 0, utilisation: 0 }); // a week of leave
    expect(r.rows.find((x) => x.userId === left)).toMatchObject({ loggedHours: 3 });
    expect(r.totals.loggedHours).toBe(15.5);
    expect(r.current).toBe(true);
  });

  it("counts working hours only up to today in the current period", async () => {
    const r = await loadHoursReport(db, { scope: { organizationId: org }, organizationId: org, period: "week", at: "2026-11-04", today: "2026-11-04", calendar: CAL, holidays: [] });
    expect(r).toMatchObject({ from: "2026-11-02", to: "2026-11-08" });
    expect(r.rows.find((x) => x.userId === ana)).toMatchObject({ availableHours: 45, availableSoFar: 27, loggedHours: 12.5, utilisation: 46 });
  });

  it("shows a project manager only the time on the projects they manage", async () => {
    const r = await loadHoursReport(db, { scope: { organizationId: org, managerId: boss }, organizationId: org, period: "month", at: "2026-11-01", today: "2026-11-30", calendar: CAL, holidays: [] });
    expect(r.rows.find((x) => x.userId === ana)).toMatchObject({ loggedHours: 8.5, clientHours: 6, internalHours: 2.5 });
    const other = await loadHoursReport(db, { scope: { organizationId: org, managerId: ali }, organizationId: org, period: "month", at: "2026-11-01", today: "2026-11-30", calendar: CAL, holidays: [] });
    expect(other.rows.map((x) => x.userId).sort()).toEqual([ali, ana].sort());
    expect(other.rows.find((x) => x.userId === ana)?.loggedHours).toBe(4);
  });

  it("keeps other organisations out", async () => {
    const stranger = (await db.organization.create({ data: { name: "Stranger" } })).id;
    const r = await loadHoursReport(db, { scope: { organizationId: org }, organizationId: stranger, period: "month", at: "2026-11-01", today: "2026-11-30", calendar: CAL, holidays: [] });
    expect(r.rows).toEqual([]);
  });
});
