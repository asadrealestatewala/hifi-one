// loadMyDay against hifi_one_test: the clock, the daily report, circulars and tasks as one person sees them.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { loadMyDay } from "./my-day";
import { calendarFrom } from "./working-calendar";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
const TZ = "Asia/Karachi";
const DAY = "2026-11-12"; // a Thursday, after daily reports went live
const CAL = calendarFrom(null, TZ);
const PERMS = new Set(["self.attendance", "meetings.use"]);

let org: string;
let user: string;

const day = (over: { date?: string; holidayName?: string | null } = {}) =>
  loadMyDay(db, { organizationId: org, userId: user, permissions: PERMS, date: over.date ?? DAY, timeZone: TZ, calendar: CAL, holidayName: over.holidayName ?? null, now: new Date("2026-11-12T08:00:00Z") });

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "CircularRecipient","Circular","DailyReport","LeaveRequest","LeaveType","AttendanceRecord","BreakRecord","Task","Project","EmployeeProfile","CompanyProfile","User","Organization" CASCADE');
  org = (await db.organization.create({ data: { name: "Day Org" } })).id;
  await db.companyProfile.create({ data: { organizationId: org, isDefault: true, legalName: "Day Org", timezone: TZ } });
  const u = await db.user.create({ data: { organizationId: org, name: "Worker", email: "day@x.example", passwordHash: "x", userType: "EMPLOYEE" } });
  user = u.id;
  await db.employeeProfile.create({ data: { organizationId: org, userId: user, employeeNo: "D1", joinDate: new Date("2026-01-01T00:00:00Z") } });
});

afterAll(async () => { await db.$disconnect(); });

describe("loadMyDay", () => {
  it("starts the day asking for the clock and the report", async () => {
    const d = await day();
    expect(d.kind.working).toBe(true);
    expect(d.clock.state).toBe("NOT_STARTED");
    expect(d.report).toBe("MISSING");
    expect(d.items.map((i) => i.id)).toEqual(["clock-in", "report"]);
  });

  it("counts the minutes worked once you are clocked in, and asks you to clock out", async () => {
    await db.attendanceRecord.create({ data: { userId: user, workDate: DAY, clockIn: new Date("2026-11-12T04:00:00Z") } }); // 09:00 Karachi
    const d = await day();
    expect(d.clock.state).toBe("WORKING");
    expect(d.clock.workedMinutes).toBe(240); // 09:00 to 13:00 Karachi
    expect(d.items.map((i) => i.id)).toContain("clock-out");
  });

  it("knows you are on a break", async () => {
    const rec = (await db.attendanceRecord.findFirst({ where: { userId: user, workDate: DAY } }))!;
    const brk = await db.breakRecord.create({ data: { attendanceId: rec.id, startAt: new Date("2026-11-12T07:00:00Z") } });
    expect((await day()).clock.state).toBe("ON_BREAK");
    await db.breakRecord.update({ where: { id: brk.id }, data: { endAt: new Date("2026-11-12T07:30:00Z") } });
    const d = await day();
    expect(d.clock.state).toBe("WORKING");
    expect(d.clock.breaks).toBe(30);
    expect(d.clock.workedMinutes).toBe(210);
  });

  it("stops asking for the report once it is written", async () => {
    await db.dailyReport.create({ data: { organizationId: org, userId: user, workDate: DAY, summary: "Wrote the My day screen." } });
    expect((await day()).report).toBe("SENT");
    expect((await day()).items.map((i) => i.id)).not.toContain("report");
  });

  it("counts circulars that have not been confirmed", async () => {
    const c = await db.circular.create({ data: { organizationId: org, title: "Office closed Monday", body: "Please note.", sentById: user } });
    const r = await db.circularRecipient.create({ data: { circularId: c.id, userId: user } });
    expect((await day()).circulars).toBe(1);
    await db.circularRecipient.update({ where: { id: r.id }, data: { ackAt: new Date() } });
    expect((await day()).circulars).toBe(0);
  });

  it("separates tasks that are overdue from tasks due today", async () => {
    const project = await db.project.create({ data: { organizationId: org, name: "Work", number: "P-001", managerId: user, status: "ACTIVE" } });
    await db.task.create({ data: { projectId: project.id, title: "Late one", assigneeId: user, dueDate: new Date("2026-11-10T00:00:00Z") } });
    await db.task.create({ data: { projectId: project.id, title: "Today's one", assigneeId: user, dueDate: new Date("2026-11-12T06:00:00Z") } });
    const d = await day();
    expect(d.tasks).toMatchObject({ overdue: 1, dueToday: 1, open: 2 });
    const order = d.items.map((i) => i.id);
    expect(order.indexOf("tasks-overdue")).toBeLessThan(order.indexOf("tasks-today"));
  });

  it("expects nothing on a public holiday", async () => {
    const d = await day({ date: "2026-11-13", holidayName: "Company day" }); // a Friday
    expect(d.kind.working).toBe(false);
    expect(d.kind.reason).toContain("Company day");
    expect(d.report).toBe("NOT_EXPECTED");
    expect(d.items.map((i) => i.id)).not.toContain("clock-in");
  });

  it("expects nothing on a weekly off", async () => {
    const d = await day({ date: "2026-11-14" }); // Saturday
    expect(d.kind.reason).toContain("Saturday");
    expect(d.items.map((i) => i.id)).not.toContain("report");
  });

  it("expects nothing while the person is on approved leave", async () => {
    const type = await db.leaveType.create({ data: { organizationId: org, name: "Annual", daysPerYear: 20, paid: true } });
    const req = await db.leaveRequest.create({ data: { userId: user, leaveTypeId: type.id, startDate: "2026-11-16", endDate: "2026-11-16", days: 1, status: "APPROVED" } });
    const d = await day({ date: "2026-11-16" }); // a Monday
    expect(d.kind.working).toBe(false);
    expect(d.kind.reason).toContain("Annual");
    await db.leaveRequest.delete({ where: { id: req.id } });
  });

  it("shows another person nothing of this person's day", async () => {
    const other = await db.user.create({ data: { organizationId: org, name: "Other", email: "other@x.example", passwordHash: "x", userType: "EMPLOYEE" } });
    const d = await loadMyDay(db, { organizationId: org, userId: other.id, permissions: PERMS, date: DAY, timeZone: TZ, calendar: CAL });
    expect(d.clock.state).toBe("NOT_STARTED");
    expect([d.circulars, d.tasks.open]).toEqual([0, 0]);
  });
});
