// End-of-day snapshots and monthly scorecards against hifi_one_test.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { submitDailyReport } from "./daily-reports";
import { generateEndOfDay, monthlyScorecards, scoreDay, snapshotDay } from "./scorecards";
import { JOBS, runJobs } from "./jobs";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
const TZ = "Asia/Karachi";
const DAY = "2026-11-10";

let org: string;
let office: string; // office cold-caller, target 20
let field: string; // field agent, target 10
let dev: string; // developer, no target
let away: string; // on leave

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "DayScorecard","DailyReport","JobRun","Notification","ProspectVisit","ProspectOutreach","DemoBooking","Prospect","SalesAgentProfile","SaasProduct","TimeEntry","Task","Project","LeaveRequest","LeaveType","AttendanceRecord","BreakRecord","EmployeeProfile","CompanyProfile","User","Organization" CASCADE');
  org = (await db.organization.create({ data: { name: "Score Org" } })).id;
  await db.companyProfile.create({ data: { organizationId: org, isDefault: true, legalName: "Score Org", timezone: TZ } });
  const mk = async (name: string, no: string) => {
    const u = await db.user.create({ data: { organizationId: org, name, email: `${no}@x.example`, passwordHash: "x", userType: "EMPLOYEE" } });
    await db.employeeProfile.create({ data: { organizationId: org, userId: u.id, employeeNo: no, joinDate: new Date("2026-01-01T00:00:00Z") } });
    return u.id;
  };
  office = await mk("Office Agent", "O1"); field = await mk("Field Agent", "F1"); dev = await mk("Developer", "D1"); away = await mk("Away", "A1");
  const product = await db.saasProduct.create({ data: { organizationId: org, code: "AGY", name: "Agentify ERP", businessLabel: "Real estate agency", dailyVisitTarget: 10 } });
  await db.salesAgentProfile.create({ data: { organizationId: org, userId: office, productId: product.id, kind: "OFFICE", dailyVisitTarget: 20 } });
  await db.salesAgentProfile.create({ data: { organizationId: org, userId: field, productId: product.id, kind: "FIELD" } });
  const type = await db.leaveType.create({ data: { organizationId: org, name: "Annual", daysPerYear: 10 } });
  await db.leaveRequest.create({ data: { userId: away, leaveTypeId: type.id, startDate: DAY, endDate: DAY, days: 1, status: "APPROVED" } });
  // Attendance: office on time 09:05 to 18:30 (9h25m), field late at 09:40 for 6h, dev never clocked in
  await db.attendanceRecord.create({ data: { userId: office, workDate: DAY, clockIn: new Date("2026-11-10T04:05:00Z"), clockOut: new Date("2026-11-10T13:30:00Z") } });
  await db.attendanceRecord.create({ data: { userId: field, workDate: DAY, clockIn: new Date("2026-11-10T04:40:00Z"), clockOut: new Date("2026-11-10T10:40:00Z") } });
  // Office agent: 12 prospects added and 6 calls = 18 of 20
  for (let i = 0; i < 12; i++) await db.prospect.create({ data: { organizationId: org, placeId: `manual:biz-${i}`, name: `Biz ${i}`, addedById: office, origin: "MANUAL", createdAt: new Date("2026-11-10T06:00:00Z") } });
  const p0 = await db.prospect.findFirstOrThrow({ where: { organizationId: org } });
  for (let i = 0; i < 6; i++) await db.prospectOutreach.create({ data: { organizationId: org, prospectId: p0.id, userId: office, outcome: "CONTACTED", createdAt: new Date("2026-11-10T07:00:00Z") } });
  // Field agent: 10 visits to 10 businesses = target met, one demo requested
  for (let i = 0; i < 10; i++) {
    const pr = await db.prospect.create({ data: { organizationId: org, placeId: `manual:shop-${i}`, name: `Shop ${i}`, origin: "MANUAL", createdAt: new Date("2026-11-10T05:00:00Z") } });
    await db.prospectVisit.create({ data: { organizationId: org, agentId: field, prospectId: pr.id, visitedAt: new Date(`2026-11-10T0${5 + (i % 4)}:${10 + i}:00Z`), outcome: i === 0 ? "DEMO_REQUESTED" : "NOT_INTERESTED", locationSource: "NONE", clientRef: `ref-${i}` } });
    if (i === 0) await db.demoBooking.create({ data: { organizationId: org, prospectId: pr.id, requestedById: field, requestedAt: new Date("2026-11-10T05:15:00Z") } });
  }
  // Developer: two tasks done, one overdue, 7.5h logged, report sent and rated 5
  const project = await db.project.create({ data: { organizationId: org, number: "P-1", name: "P", managerId: office, status: "ACTIVE" } });
  for (const t of ["a", "b"]) await db.task.create({ data: { projectId: project.id, title: t, status: "DONE", assigneeId: dev, completedAt: new Date("2026-11-10T09:00:00Z") } });
  await db.task.create({ data: { projectId: project.id, title: "late", status: "IN_PROGRESS", assigneeId: dev, dueDate: new Date("2026-11-09T00:00:00Z") } });
  await db.timeEntry.create({ data: { organizationId: org, projectId: project.id, userId: dev, workDate: DAY, hours: 7.5 } });
  const r = await submitDailyReport(db, { organizationId: org, userId: dev, workDate: DAY, today: DAY, summary: "Shipped the invoice PDF and fixed the login bug" });
  await db.dailyReport.update({ where: { id: r.report.id }, data: { rating: 5, reviewedAt: new Date(), reviewedById: office } });
  await submitDailyReport(db, { organizationId: org, userId: office, workDate: DAY, today: "2026-11-11", summary: "Called the real estate list, 12 new prospects" }); // a day late
});
afterAll(() => db.$disconnect());

describe("the score", () => {
  it("adds attendance, punctuality, report and output, and says where output came from", () => {
    expect(scoreDay({ attendanceMinutes: 540, lateMinutes: 0, reportStatus: "SENT", target: 10, activity: 10, rating: null })).toEqual({ score: 100, parts: { attendance: 30, punctuality: 10, report: 20, output: 40, outputBasis: "target" } });
    expect(scoreDay({ attendanceMinutes: 270, lateMinutes: 25, reportStatus: "LATE", target: null, activity: 0, rating: 4 }).parts).toEqual({ attendance: 15, punctuality: 4, report: 10, output: 32, outputBasis: "rating" });
    expect(scoreDay({ attendanceMinutes: 0, lateMinutes: 0, reportStatus: "MISSING", target: null, activity: 0, rating: null }).score).toBe(0);
    expect(scoreDay({ attendanceMinutes: 540, lateMinutes: 0, reportStatus: "SENT", target: null, activity: 0, rating: null }).parts.outputBasis).toBe("report");
  });
});

describe("the end-of-day snapshot", () => {
  it("reads each person's day in company time and scores it", async () => {
    const rows = await snapshotDay(db, { organizationId: org, workDate: DAY, timeZone: TZ });
    const o = rows.find((r) => r.userId === office)!;
    expect([o.clockIn, o.clockOut, o.attendanceMinutes, o.lateMinutes]).toEqual(["09:05", "18:30", 565, 0]);
    expect([o.salesKind, o.prospectsAdded, o.outreach, o.activity, o.target, o.reportStatus]).toEqual(["OFFICE", 12, 6, 18, 20, "LATE"]);
    expect(o.score).toBe(30 + 10 + 10 + 36);
    const f = rows.find((r) => r.userId === field)!;
    expect([f.lateMinutes, f.visits, f.activity, f.target, f.demosRequested, f.reportStatus]).toEqual([30, 10, 10, 10, 1, "MISSING"]);
    expect(f.score).toBe(20 + 4 + 0 + 40);
    const d = rows.find((r) => r.userId === dev)!;
    expect([d.attendanceMinutes, d.tasksDone, d.tasksOverdue, Number(d.hoursLogged), d.target, d.rating]).toEqual([0, 2, 1, 7.5, null, 5]);
    expect(d.scoreParts).toMatchObject({ attendance: 0, punctuality: 0, report: 20, output: 40, outputBasis: "rating" });
    const a = rows.find((r) => r.userId === away)!;
    expect([a.expected, a.score]).toEqual([false, 0]);
  });
  it("stores the rows once, replaces them on a rerun, and sums the month", async () => {
    const first = await generateEndOfDay(db, { organizationId: org, workDate: DAY, timeZone: TZ });
    expect([first.expected, first.reported, first.missing.map((m) => m.userId), first.belowTarget.map((m) => m.userId), first.absent.map((m) => m.userId)]).toEqual([3, 2, [field], [office], [dev]]);
    expect(await db.dayScorecard.count({ where: { organizationId: org } })).toBe(4);
    await submitDailyReport(db, { organizationId: org, userId: field, workDate: DAY, today: DAY, summary: "Visited ten shops in Saddar, one demo asked" });
    const again = await generateEndOfDay(db, { organizationId: org, workDate: DAY, timeZone: TZ });
    expect(again.missing).toEqual([]);
    expect(await db.dayScorecard.count({ where: { organizationId: org } })).toBe(4);
    const month = await monthlyScorecards(db, { organizationId: org, month: "2026-11" });
    expect(month.map((m) => m.userId)).not.toContain(away);
    const f = month.find((m) => m.userId === field)!;
    expect([f.days, f.present, f.lateDays, f.reportsSent, f.activity, f.target, f.avgScore]).toEqual([1, 1, 1, 1, 10, 10, 84]);
    const d = month.find((m) => m.userId === dev)!;
    expect([d.present, d.avgRating, d.tasksDone, d.hoursLogged]).toEqual([0, 5, 2, 7.5]);
  });
});

describe("the job", () => {
  it("waits for office close in company time, then runs once and tells HR", async () => {
    const job = JOBS.find((j) => j.key === "end_of_day_report")!;
    expect(job.notBeforeClose).toBe(true); // the working calendar says when that is; the default is 18:30
    const early = await runJobs(db, { only: ["end_of_day_report"], organizationId: org, now: new Date("2026-11-10T12:00:00Z") }); // 17:00 Karachi
    expect(early[0]).toMatchObject({ status: "SKIPPED" });
    expect(await db.jobRun.count({ where: { organizationId: org, key: "end_of_day_report" } })).toBe(0);
    const late = await runJobs(db, { only: ["end_of_day_report"], organizationId: org, now: new Date("2026-11-10T13:35:00Z") }); // 18:35 Karachi
    expect(late[0].status).toBe("OK");
    expect(late[0].summary).toMatch(/3 expected/);
    const rerun = await runJobs(db, { only: ["end_of_day_report"], organizationId: org, now: new Date("2026-11-10T14:00:00Z") });
    expect(rerun[0].status).toBe("SKIPPED");
    const forced = await runJobs(db, { only: ["end_of_day_report"], organizationId: org, now: new Date("2026-11-10T09:00:00Z"), force: true }); // a manual run earlier in the day is allowed
    expect(forced[0].status).toBe("OK");
  });
});
