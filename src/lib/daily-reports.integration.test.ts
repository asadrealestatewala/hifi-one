// Daily reports against hifi_one_test: writing, editing, review rights, who is expected, and the day's facts beside each report.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { ReportError, dayBounds, dayStatus, missingReports, myRecentDays, reportExpected, reviewDailyReport, submitDailyReport } from "./daily-reports";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
const TZ = "Asia/Karachi";
const TODAY = "2026-11-10"; // a Tuesday

let org: string;
let emp: string;
let boss: string;
let hr: string;
let onLeave: string;

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "DailyReport","LeaveRequest","LeaveType","AttendanceRecord","BreakRecord","Task","Project","EmployeeProfile","User","Organization" CASCADE');
  org = (await db.organization.create({ data: { name: "Reports Org" } })).id;
  const mk = async (name: string, no: string, managerId?: string) => {
    const u = await db.user.create({ data: { organizationId: org, name, email: `${no}@x.example`, passwordHash: "x", userType: "EMPLOYEE", managerId } });
    await db.employeeProfile.create({ data: { organizationId: org, userId: u.id, employeeNo: no, joinDate: new Date("2026-01-01T00:00:00Z") } });
    return u.id;
  };
  boss = await mk("Boss", "B1");
  hr = await mk("HR", "H1");
  emp = await mk("Emp", "E1", boss);
  onLeave = await mk("Away", "A1", boss);
  const type = await db.leaveType.create({ data: { organizationId: org, name: "Annual", daysPerYear: 10 } });
  await db.leaveRequest.create({ data: { userId: onLeave, leaveTypeId: type.id, startDate: "2026-11-09", endDate: "2026-11-11", days: 3, status: "APPROVED" } });
  // Emp clocked 9:00 to 18:30 Karachi with a 30 minute break, and finished two tasks that afternoon
  const rec = await db.attendanceRecord.create({ data: { userId: emp, workDate: TODAY, clockIn: new Date("2026-11-10T04:00:00Z"), clockOut: new Date("2026-11-10T13:30:00Z") } });
  await db.breakRecord.create({ data: { attendanceId: rec.id, startAt: new Date("2026-11-10T08:00:00Z"), endAt: new Date("2026-11-10T08:30:00Z") } });
  const project = await db.project.create({ data: { organizationId: org, number: "P-1", name: "P", managerId: boss, status: "ACTIVE" } });
  for (const t of ["a", "b"]) await db.task.create({ data: { projectId: project.id, title: t, status: "DONE", assigneeId: emp, completedAt: new Date("2026-11-10T10:00:00Z") } });
  await db.task.create({ data: { projectId: project.id, title: "late night UTC, next day in Karachi", status: "DONE", assigneeId: emp, completedAt: new Date("2026-11-10T20:00:00Z") } });
});
afterAll(() => db.$disconnect());

describe("pure rules", () => {
  it("a Karachi day runs from 19:00 UTC the evening before", () => {
    const b = dayBounds(TODAY, TZ);
    expect(b.gte.toISOString()).toBe("2026-11-09T19:00:00.000Z");
    expect(b.lt.toISOString()).toBe("2026-11-10T19:00:00.000Z");
  });
  it("no report is expected on weekends, on approved leave, or before joining", () => {
    expect(reportExpected({ workDate: "2026-11-08", leaves: [] })).toBe(false); // Sunday
    expect(reportExpected({ workDate: "2026-11-09", leaves: [] })).toBe(false); // before the feature went live
    expect(reportExpected({ workDate: TODAY, leaves: [] })).toBe(true);
    expect(reportExpected({ workDate: TODAY, leaves: [{ startDate: "2026-11-09", endDate: "2026-11-11" }] })).toBe(false);
    expect(reportExpected({ workDate: TODAY, joinDate: "2026-12-01", leaves: [] })).toBe(false);
  });
});

describe("writing a report", () => {
  it("needs a real summary, a past or present date within a week, and sane hours", async () => {
    const base = { organizationId: org, userId: emp, today: TODAY };
    await expect(submitDailyReport(db, { ...base, workDate: TODAY, summary: "ok" })).rejects.toThrow(/at least a sentence/);
    await expect(submitDailyReport(db, { ...base, workDate: "2026-11-11", summary: "Worked on the website redesign" })).rejects.toThrow(/not happened yet/);
    await expect(submitDailyReport(db, { ...base, workDate: "2026-11-01", summary: "Worked on the website redesign" })).rejects.toThrow(/last 7 days/);
    await expect(submitDailyReport(db, { ...base, workDate: TODAY, summary: "Worked on the website redesign", hoursWorked: "30" })).rejects.toThrow(/between 0 and 24/);
  });
  it("creates today's report, lets the employee edit it, and marks a back-dated one late", async () => {
    const a = await submitDailyReport(db, { organizationId: org, userId: emp, workDate: TODAY, today: TODAY, summary: "Finished the landing page and fixed two bugs", hoursWorked: "8.3", plan: "Start the pricing page" });
    expect(a.created).toBe(true);
    expect(a.report.late).toBe(false);
    expect(a.report.hoursWorked?.toString()).toBe("8.5");
    const b = await submitDailyReport(db, { organizationId: org, userId: emp, workDate: TODAY, today: TODAY, summary: "Finished the landing page, fixed two bugs, reviewed a PR" });
    expect(b.created).toBe(false);
    expect(b.report.id).toBe(a.report.id);
    const late = await submitDailyReport(db, { organizationId: org, userId: emp, workDate: "2026-11-09", today: TODAY, summary: "Catching up on yesterday's report" });
    expect(late.report.late).toBe(true);
  });
});

describe("who is expected and the day's facts", () => {
  it("HR sees everyone with attendance, tasks and leave beside the report", async () => {
    const rows = await dayStatus(db, { organizationId: org, workDate: TODAY, timeZone: TZ });
    const e = rows.find((r) => r.userId === emp)!;
    expect(e.report).not.toBeNull();
    expect(e.attendanceMinutes).toBe(9 * 60); // 9.5 hours minus the 30 minute break
    expect(e.tasksDone).toBe(2); // the 20:00 UTC task belongs to the next Karachi day
    const away = rows.find((r) => r.userId === onLeave)!;
    expect(away.onLeave).toBe(true);
    expect(away.expected).toBe(false);
    expect((await missingReports(db, org, TODAY, TZ)).map((r) => r.userId).sort()).toEqual([boss, hr].sort());
    expect(await missingReports(db, org, "2026-11-08", TZ)).toEqual([]); // Sunday
  });
  it("a manager sees only direct reports", async () => {
    const rows = await dayStatus(db, { organizationId: org, workDate: TODAY, timeZone: TZ, managerId: boss });
    expect(rows.map((r) => r.userId).sort()).toEqual([emp, onLeave].sort());
  });
  it("the employee's own recent days show covered and missed working days", async () => {
    const days = await myRecentDays(db, { organizationId: org, userId: emp, today: TODAY, days: 3 });
    expect(days.map((d) => [d.workDate, d.expected, Boolean(d.report)])).toEqual([[TODAY, true, true], ["2026-11-09", false, true], ["2026-11-08", false, false]]);
  });
});

describe("review", () => {
  it("only the manager or HR may review, never yourself, and the report then locks", async () => {
    const r = (await db.dailyReport.findUnique({ where: { userId_workDate: { userId: emp, workDate: TODAY } } }))!;
    await expect(reviewDailyReport(db, { organizationId: org, reportId: r.id, reviewerId: emp, canReviewAll: true })).rejects.toThrow(/own report/);
    await expect(reviewDailyReport(db, { organizationId: org, reportId: r.id, reviewerId: hr, canReviewAll: false })).rejects.toThrow(/manager or HR/);
    await expect(reviewDailyReport(db, { organizationId: org, reportId: r.id, reviewerId: boss, canReviewAll: false, rating: 9 })).rejects.toThrow(/1 to 5/);
    const done = await reviewDailyReport(db, { organizationId: org, reportId: r.id, reviewerId: boss, canReviewAll: false, rating: "4", note: "Good day" });
    expect(done.rating).toBe(4);
    expect(done.reviewedById).toBe(boss);
    await expect(submitDailyReport(db, { organizationId: org, userId: emp, workDate: TODAY, today: TODAY, summary: "Trying to change it after review" })).rejects.toThrow(ReportError);
    // HR with canReviewAll may review anyone
    const late = (await db.dailyReport.findUnique({ where: { userId_workDate: { userId: emp, workDate: "2026-11-09" } } }))!;
    expect((await reviewDailyReport(db, { organizationId: org, reportId: late.id, reviewerId: hr, canReviewAll: true })).reviewedById).toBe(hr);
  });
});
