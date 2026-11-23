// Attendance and performance reports, the owners' daily email and "My target today" (HR's Required Changes, items 5, 7,
// 12 and 15), against hifi_one_test: each person's day, the month grid, on-time and late tasks, review answer times, the
// downloads, who gets the 6:45 PM email, and the denied cases.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { attendanceReport, dayState, taskPerformance } from "./attendance-report";
import { ownerDay, sendOwnerDaily } from "./owner-daily";
import { myTargetToday } from "./my-target";
import { REPORTS, buildReport, reportXlsx } from "./report-tables";
import { readWorkbook } from "./spreadsheet";
import { addMinutesToTime } from "./jobs";
import { calendarFrom } from "./working-calendar";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
const TZ = "Asia/Karachi";
const cal = calendarFrom({ workStart: "09:00", workEnd: "18:30", lunchMinutes: 30, graceMinutes: 15, workDays: "1,2,3,4,5" }, TZ);
const DAY = "2026-11-23"; // a Monday
const NOW = new Date("2026-11-23T13:45:00.000Z"); // 18:45 in Karachi, fifteen minutes after close
const at = (hhmm: string, date = DAY) => new Date(`${date}T${hhmm}:00+05:00`);
let org: string, otherOrg: string, owner: string, pm: string, ali: string, bina: string, cyra: string, dan: string, eve: string, fay: string;

const role = async (key: string, perms: string[]) => {
  const r = await db.role.create({ data: { organizationId: org, key, name: key } });
  for (const k of perms) {
    const p = await db.permission.upsert({ where: { key: k }, update: {}, create: { key: k, description: k } });
    await db.rolePermission.create({ data: { roleId: r.id, permissionId: p.id } });
  }
  return r.id;
};
let n = 0;
const person = async (name: string, o = org, extra: { active?: boolean; joinDate?: Date; roleId?: string; hr?: boolean } = {}) => {
  const u = await db.user.create({ data: { organizationId: o, name, email: `${name.toLowerCase().replace(/\s/g, "")}@att.test`, passwordHash: "x", userType: "EMPLOYEE", active: extra.active ?? true, ...(extra.roleId ? { roles: { create: { roleId: extra.roleId } } } : {}) } });
  if (extra.hr !== false) await db.employeeProfile.create({ data: { organizationId: o, userId: u.id, employeeNo: `E-${++n}`, joinDate: extra.joinDate ?? new Date("2025-01-01T00:00:00Z") } });
  return u.id;
};

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "Notification","EmailMessage","AuditLog","DailyReport","BreakRecord","AttendanceRecord","LeaveRequest","LeaveType","SiteVisitRequest","TaskReview","TaskIssue","Task","ProjectMember","Project","SalesTarget","LeadActivity","Lead","PipelineStage","SalesAgentProfile","ProspectOutreach","ProspectVisit","Prospect","SaasProduct","EmployeeProfile","DayScorecard","JobRun","WorkingCalendar","PublicHoliday","UserRole","RolePermission","Role","Permission","User","CompanyProfile","Organization" CASCADE');
  org = (await db.organization.create({ data: { name: "Attendance Org" } })).id;
  otherOrg = (await db.organization.create({ data: { name: "Other Org" } })).id;
  await db.companyProfile.create({ data: { organizationId: org, isDefault: true, legalName: "Attendance Org", timezone: TZ } });
  await db.workingCalendar.create({ data: { organizationId: org, workStart: "09:00", workEnd: "18:30", lunchMinutes: 30, graceMinutes: 15, workDays: "1,2,3,4,5" } });
  owner = await person("Olga Owner", org, { roleId: await role("OWNER", ["dashboard.executive"]), hr: false });
  await person("Hidden Owner", org, { roleId: await role("OWNER2", ["dashboard.executive"]), hr: false, active: false });
  pm = await person("Pia PM");
  ali = await person("Ali Ontime");
  bina = await person("Bina Late");
  cyra = await person("Cyra Absent");
  dan = await person("Dan Leave");
  eve = await person("Eve Out");
  fay = await person("Fay New", org, { joinDate: new Date("2026-11-24T00:00:00Z") });
  await person("Gus Gone", org, { active: false });
  await person("Other Org Person", otherOrg);

  await db.attendanceRecord.create({ data: { userId: ali, workDate: DAY, clockIn: at("09:05"), clockOut: at("18:31") } });
  await db.attendanceRecord.create({ data: { userId: bina, workDate: DAY, clockIn: at("09:41") } });
  await db.attendanceRecord.create({ data: { userId: pm, workDate: DAY, clockIn: at("08:55") } });
  const lt = await db.leaveType.create({ data: { organizationId: org, name: "Annual leave", daysPerYear: 14 } });
  await db.leaveRequest.create({ data: { userId: dan, leaveTypeId: lt.id, startDate: DAY, endDate: "2026-11-24", days: 2, status: "APPROVED" } });
  await db.leaveRequest.create({ data: { userId: cyra, leaveTypeId: lt.id, startDate: DAY, endDate: DAY, days: 1, status: "PENDING" } }); // not approved: still absent
  await db.siteVisitRequest.create({ data: { organizationId: org, userId: eve, kind: "SITE_VISIT", startDate: DAY, endDate: DAY, purpose: "Client meeting", location: "Blue Area", status: "APPROVED" } });
  await db.dailyReport.create({ data: { organizationId: org, userId: ali, workDate: DAY, summary: "Finished the launch post" } });
  await db.dailyReport.create({ data: { organizationId: org, userId: pm, workDate: DAY, summary: "Reviews" } });

  const project = await db.project.create({ data: { organizationId: org, number: "PRJ-0001", name: "Website", managerId: pm } });
  const old = await db.project.create({ data: { organizationId: org, number: "PRJ-0002", name: "Closed", managerId: pm, status: "COMPLETED" } });
  const due = (d: string) => new Date(`${d}T00:00:00Z`);
  const task = (data: object) => db.task.create({ data: { projectId: project.id, title: "Task", ...data } });
  await task({ title: "On time", assigneeId: ali, status: "DONE", dueDate: due(DAY), completedAt: at("11:00") });
  await task({ title: "Done late", assigneeId: ali, status: "DONE", dueDate: due("2026-11-20"), completedAt: at("12:00") });
  await task({ title: "No deadline", assigneeId: bina, status: "DONE", completedAt: at("13:00") });
  const lateNoon = await task({ title: "Due at noon", assigneeId: bina, status: "IN_PROGRESS", dueDate: due(DAY), dueTime: "12:00" });
  await task({ title: "Due at close", assigneeId: cyra, dueDate: due(DAY) });
  await task({ title: "Due tomorrow", assigneeId: cyra, dueDate: due("2026-11-24") });
  await db.task.create({ data: { projectId: old.id, title: "Old late", assigneeId: cyra, dueDate: due("2026-11-01") } }); // closed project: not counted
  const inReview = await task({ title: "In review", assigneeId: bina, status: "REVIEW" });
  await db.taskIssue.create({ data: { taskId: lateNoon.id, reportedById: bina, body: "No logo yet" } });
  await db.taskReview.create({ data: { taskId: inReview.id, submittedById: bina, submittedAt: at("17:00") } });
  await db.taskReview.create({ data: { taskId: lateNoon.id, submittedById: bina, submittedAt: at("10:00"), respondedAt: at("10:06"), respondedById: pm, outcome: "REVISION" } });
});
afterAll(async () => { await db.$disconnect(); });

describe("one person's day", () => {
  const base = { date: DAY, today: DAY, nowTime: "18:45", calendar: cal, holidays: [] as string[], joined: null, clockIn: null, leave: null, out: null };
  it("counts late only past the start time and the grace", () => {
    expect(dayState({ ...base, clockIn: "09:15" })).toEqual({ state: "PRESENT", late: 0, note: null });
    expect(dayState({ ...base, clockIn: "09:41" })).toMatchObject({ state: "LATE", late: 26 });
  });
  it("puts the clock first, then holiday, day off, leave, out for work, then absent", () => {
    expect(dayState({ ...base, holidays: [DAY], holidayName: "Iqbal Day", clockIn: "10:30" })).toMatchObject({ state: "PRESENT", late: 0, note: "Worked on Iqbal Day" });
    expect(dayState({ ...base, holidays: [DAY], holidayName: "Iqbal Day", leave: "Annual leave" })).toMatchObject({ state: "HOLIDAY", note: "Iqbal Day" });
    expect(dayState({ ...base, date: "2026-11-22", leave: "Annual leave" }).state).toBe("OFF");
    expect(dayState({ ...base, leave: "Annual leave", out: "Field work" })).toMatchObject({ state: "LEAVE", note: "Annual leave" });
    expect(dayState({ ...base, out: "Field work" })).toMatchObject({ state: "OUT", note: "Field work" });
    expect(dayState(base).state).toBe("ABSENT");
  });
  it("waits for the start time and grace before calling today absent, and leaves the future and days before joining blank", () => {
    expect(dayState({ ...base, nowTime: "09:10" })).toMatchObject({ state: "UPCOMING", note: "Not in yet" });
    expect(dayState({ ...base, nowTime: "09:16" }).state).toBe("ABSENT");
    expect(dayState({ ...base, date: "2026-11-24" }).state).toBe("UPCOMING");
    expect(dayState({ ...base, joined: "2026-11-24" }).state).toBe("NOT_JOINED");
  });
});

describe("the attendance report", () => {
  it("lists every active member of staff with an HR record, never another organization's", async () => {
    const r = await attendanceReport(db, { organizationId: org, from: DAY, to: DAY, calendar: cal, holidays: [], now: NOW });
    const by = Object.fromEntries(r.people.map((p) => [p.name, p.days[0]]));
    expect(Object.keys(by)).toEqual(["Ali Ontime", "Bina Late", "Cyra Absent", "Dan Leave", "Eve Out", "Fay New", "Pia PM"]);
    expect(by["Ali Ontime"]).toMatchObject({ state: "PRESENT", clockIn: "09:05", clockOut: "18:31" });
    expect(by["Bina Late"]).toMatchObject({ state: "LATE", clockIn: "09:41", lateMinutes: 26 });
    expect(by["Cyra Absent"].state).toBe("ABSENT"); // a leave that is still waiting does not count
    expect(by["Dan Leave"]).toMatchObject({ state: "LEAVE", note: "Annual leave" });
    expect(by["Eve Out"]).toMatchObject({ state: "OUT", note: "Site or client visit, Blue Area" });
    expect(by["Fay New"].state).toBe("NOT_JOINED");
    expect(r.totals).toMatchObject({ expected: 6, present: 3, late: 1, absent: 1, leave: 1, out: 1, lateMinutes: 26 });
  });

  it("covers a month a day at a time, with days off and the days still to come", async () => {
    const r = await attendanceReport(db, { organizationId: org, from: "2026-11-01", to: "2026-11-30", calendar: cal, holidays: [{ date: "2026-11-09", name: "Iqbal Day" }], now: NOW });
    expect(r.dates).toHaveLength(30);
    const d = r.people.find((p) => p.userId === dan)!;
    expect(d.days.find((d) => d.date === "2026-11-09")!.state).toBe("HOLIDAY");
    expect(d.days.find((d) => d.date === "2026-11-22")!.state).toBe("OFF");
    expect(d.days.find((d) => d.date === "2026-11-24")!.state).toBe("LEAVE"); // approved leave shows ahead of time
    expect(d.days.find((d) => d.date === "2026-11-25")!.state).toBe("UPCOMING");
    expect(r.people.find((p) => p.userId === ali)!.totals.present).toBe(1);
  });

  it("downloads as Excel with the same rows the screen shows, and needs HR's attendance permission", async () => {
    expect(REPORTS.attendance.permission).toBe("attendance.view_all");
    expect(REPORTS.performance.permission).toBe("attendance.view_all");
    const table = await buildReport(db, "attendance", { organizationId: org, from: DAY, to: DAY });
    const book = await readWorkbook(Buffer.from(reportXlsx(table)), "attendance.xlsx");
    const sheet = book[0];
    expect(sheet.rows[0]).toContain("Status");
    const row = sheet.rows.find((x) => x.includes("Bina Late"))!;
    expect(row).toContain("Late");
    expect(book.map((s) => s.name)).toContain("About");
  });
});

describe("on-time performance", () => {
  it("splits finished tasks into on time, late and no deadline, and times the project manager's answers", async () => {
    const perf = await taskPerformance(db, { organizationId: org, from: "2026-11-01", to: "2026-11-30", calendar: cal });
    expect(perf.get(ali)).toMatchObject({ done: 2, onTime: 1, late: 1, noDeadline: 0 });
    expect(perf.get(bina)).toMatchObject({ done: 1, noDeadline: 1, revisions: 1 });
    expect(perf.get(pm)).toMatchObject({ reviewsAnswered: 1, avgResponseMinutes: 6 });
    expect((await taskPerformance(db, { organizationId: otherOrg, from: "2026-11-01", to: "2026-11-30", calendar: cal })).size).toBe(0);
  });
});

describe("the owners' daily email", () => {
  it("adds up the day: attendance, tasks finished and late, open issues and reviews, missing daily reports", async () => {
    const d = await ownerDay(db, { organizationId: org, date: DAY, calendar: cal, now: NOW });
    expect(d).toMatchObject({ expected: 6, present: 3, absent: ["Cyra Absent"], leave: ["Dan Leave (Annual leave)"], out: ["Eve Out (Site or client visit, Blue Area)"], tasksDone: 3, openIssues: 1, reviewsWaiting: 1 });
    expect(d.late).toEqual(["Bina Late (09:41, 26 min)"]);
    expect(d.tasksLate).toEqual(["Due at noon (Bina Late)", "Due at close (Cyra Absent)"]);
    expect(d.reports).toEqual({ sent: 2, missing: ["Bina Late", "Cyra Absent", "Eve Out"] });
  });

  it("goes once to each active person with the Executive dashboard, by email and in the bell", async () => {
    const r = await sendOwnerDaily(db, { organizationId: org, date: DAY, calendar: cal, now: NOW });
    expect(r.sent).toBe(1);
    const mails = await db.emailMessage.findMany({ where: { relatedType: "OwnerDaily" }, select: { toEmail: true, subject: true, body: true } });
    expect(mails.map((m) => m.toEmail)).toEqual(["olgaowner@att.test"]);
    expect(mails[0].subject).toContain("3 of 6 present");
    expect(mails[0].body).toContain("Cyra Absent");
    const bell = await db.notification.findMany({ where: { kind: "report.owner_daily" }, select: { userId: true, title: true, link: true } });
    expect(bell).toEqual([{ userId: owner, title: "Today: 3 of 6 present, 1 late arrival, 1 absent", link: `/hr/attendance/report?date=${DAY}` }]);
    await sendOwnerDaily(db, { organizationId: org, date: DAY, calendar: cal, now: NOW });
    expect(await db.notification.count({ where: { kind: "report.owner_daily" } })).toBe(1); // the bell notice is not repeated
  });

  it("sends nothing on a day nobody was expected at work, and waits fifteen minutes after close", async () => {
    const r = await sendOwnerDaily(db, { organizationId: org, date: "2026-11-22", calendar: cal, now: new Date("2026-11-22T13:45:00Z") });
    expect(r).toMatchObject({ sent: 0, skipped: "Nobody was expected at work today" });
    expect(addMinutesToTime("18:30", 15)).toBe("18:45");
    expect(addMinutesToTime("23:50", 15)).toBe("23:59");
  });
});

describe("My target today", () => {
  it("shows nothing when nobody set a target", async () => {
    expect(await myTargetToday(db, { organizationId: org, userId: cyra, date: DAY, timeZone: TZ })).toEqual([]);
  });

  it("counts today's work against the daily Sales targets, with connected calls waiting for a manager", async () => {
    const stage = await db.pipelineStage.create({ data: { organizationId: org, name: "New", sortOrder: 1 } });
    const lead = await db.lead.create({ data: { organizationId: org, name: "Acme", stageId: stage.id } });
    for (const t of ["10:00", "11:00", "12:00"]) await db.leadActivity.create({ data: { leadId: lead.id, actorId: bina, kind: "CALL", outcome: "NO_ANSWER", createdAt: at(t) } });
    await db.leadActivity.create({ data: { leadId: lead.id, actorId: bina, kind: "CALL", outcome: "CONNECTED", verified: true, createdAt: at("13:00") } });
    await db.leadActivity.create({ data: { leadId: lead.id, actorId: bina, kind: "CALL", outcome: "CONNECTED", createdAt: at("14:00") } });
    await db.leadActivity.create({ data: { leadId: lead.id, actorId: bina, kind: "CALL", outcome: "NO_ANSWER", createdAt: at("23:00", "2026-11-22") } }); // yesterday in Karachi
    await db.salesTarget.create({ data: { organizationId: org, userId: bina, metric: "CALLS", daily: 40 } });
    await db.salesTarget.create({ data: { organizationId: org, userId: bina, metric: "CONNECTED_CALLS", daily: 5 } });
    await db.salesTarget.create({ data: { organizationId: org, userId: bina, metric: "EMAILS", monthly: 100 } }); // monthly only: not today's
    const lines = await myTargetToday(db, { organizationId: org, userId: bina, date: DAY, timeZone: TZ });
    expect(lines.map((l) => [l.label, l.done, l.target, l.pending])).toEqual([["Calls made", 5, 40, undefined], ["Connected calls", 1, 5, 1]]);
    // someone else's target is never shown to this person
    expect(await myTargetToday(db, { organizationId: otherOrg, userId: bina, date: DAY, timeZone: TZ })).toEqual([]);
  });

  it("gives a field agent the Prospector visit target", async () => {
    const product = await db.saasProduct.create({ data: { organizationId: org, name: "Pharmivo", code: "PH", businessLabel: "Pharmacy", dailyVisitTarget: 40 } });
    await db.salesAgentProfile.create({ data: { organizationId: org, userId: eve, productId: product.id, kind: "FIELD" } });
    const lines = await myTargetToday(db, { organizationId: org, userId: eve, date: DAY, timeZone: TZ });
    expect(lines).toEqual([expect.objectContaining({ key: "VISITS", label: "Pharmivo visits", done: 0, target: 40, href: "/field" })]);
  });
});
