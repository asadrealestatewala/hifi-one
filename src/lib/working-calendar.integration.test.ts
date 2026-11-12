// The working calendar against hifi_one_test: what is saved, what the holidays do to leave, daily reports and scorecards.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { requestLeave } from "./hr";
import { dayStatus, submitDailyReport } from "./daily-reports";
import { generateEndOfDay } from "./scorecards";
import { addHoliday, getCalendar, getHolidays, getWorkingContext, removeHoliday, saveCalendar, seedPakistanHolidays } from "./working-calendar";

const url = process.env.TEST_DATABASE_URL ?? "postgresql://hifi:hifi_local_dev@localhost:54329/hifi_one_test";
const db = new PrismaClient({ datasourceUrl: url });
const TZ = "Asia/Karachi";

let org: string;
let user: string;
let leaveType: string;

beforeAll(async () => {
  await db.$executeRawUnsafe('TRUNCATE "PublicHoliday","WorkingCalendar","DayScorecard","DailyReport","LeaveRequest","LeaveType","AttendanceRecord","BreakRecord","EmployeeProfile","CompanyProfile","User","Organization" CASCADE');
  org = (await db.organization.create({ data: { name: "Calendar Org" } })).id;
  await db.companyProfile.create({ data: { organizationId: org, isDefault: true, legalName: "Calendar Org", timezone: TZ } });
  const u = await db.user.create({ data: { organizationId: org, name: "Worker", email: "worker@x.example", passwordHash: "x", userType: "EMPLOYEE" } });
  user = u.id;
  await db.employeeProfile.create({ data: { organizationId: org, userId: user, employeeNo: "W1", joinDate: new Date("2026-01-01T00:00:00Z") } });
  leaveType = (await db.leaveType.create({ data: { organizationId: org, name: "Annual", daysPerYear: 20, paid: true } })).id;
});

afterAll(async () => { await db.$disconnect(); });

describe("the saved calendar", () => {
  it("falls back to the built-in hours and the company time zone before anything is saved", async () => {
    const cal = await getCalendar(db, org);
    expect([cal.workStart, cal.workEnd, cal.timezone]).toEqual(["09:00", "18:30", TZ]);
    expect(cal.workDays).toEqual([1, 2, 3, 4, 5]);
    expect(cal.fullDayMinutes).toBe(540);
  });

  it("saves hours and working days, and reads them back", async () => {
    await saveCalendar(db, org, { workStart: "10:00", workEnd: "19:00", lunchMinutes: 60, graceMinutes: 15, workDays: [1, 2, 3, 4, 5, 6] }, user);
    const cal = await getCalendar(db, org);
    expect([cal.workStart, cal.workEnd, cal.lunchMinutes, cal.graceMinutes]).toEqual(["10:00", "19:00", 60, 15]);
    expect(cal.workDays).toEqual([1, 2, 3, 4, 5, 6]);
    expect(cal.weekendDays).toEqual([0]);
    expect(cal.fullDayMinutes).toBe(480);
    // put the real hours back for the tests below
    await saveCalendar(db, org, { workStart: "09:00", workEnd: "18:30", lunchMinutes: 30, graceMinutes: 10, workDays: [1, 2, 3, 4, 5] }, user);
  });
});

describe("holidays", () => {
  it("adds Pakistan's list for a year once, keeping an administrator's own date", async () => {
    await addHoliday(db, org, "2026-08-14", "Independence Day (our own wording)");
    const first = await seedPakistanHolidays(db, org, "2026");
    expect(first.kept).toBe(1);
    expect(first.added.length).toBeGreaterThan(10);
    const again = await seedPakistanHolidays(db, org, "2026");
    expect(again.added).toEqual([]);
    const all = await getHolidays(db, org, "2026-01-01", "2026-12-31");
    expect(all.find((h) => h.date === "2026-08-14")?.name).toBe("Independence Day (our own wording)");
    expect(all.map((h) => h.date)).toEqual([...all.map((h) => h.date)].sort());
  });

  it("refuses the same date twice and refuses a date that is not a date", async () => {
    await expect(addHoliday(db, org, "2026-08-14", "Again")).rejects.toThrow(/already on the list/);
    await expect(addHoliday(db, org, "14-08-2026", "Wrong way round")).rejects.toThrow(/YYYY-MM-DD/);
  });

  it("refuses a year it does not know", async () => {
    await expect(seedPakistanHolidays(db, org, "2031")).rejects.toThrow(/only built in/);
  });

  it("takes a holiday off again", async () => {
    const row = await addHoliday(db, org, "2026-10-09", "Company day");
    await removeHoliday(db, org, row.id);
    expect((await getHolidays(db, org, "2026-10-09", "2026-10-09")).length).toBe(0);
    await expect(removeHoliday(db, org, row.id)).rejects.toThrow(/not on the list/);
  });

  it("belongs to one organization only", async () => {
    const other = (await db.organization.create({ data: { name: "Someone Else" } })).id;
    expect(await getHolidays(db, other)).toEqual([]);
  });
});

describe("what a holiday changes", () => {
  it("is not counted against a leave balance", async () => {
    const cal = await getWorkingContext(db, org);
    // 13 to 17 August 2026 is Thursday to Monday: four working days, less Independence Day on the Friday.
    const r = await requestLeave(db, {
      organizationId: org, userId: user, leaveTypeId: leaveType, startDate: "2026-08-13", endDate: "2026-08-17",
      holidays: cal.holidayDates, weekend: cal.calendar.weekendDays,
    });
    expect(Number(r.days)).toBe(2); // Thursday and Monday; Friday is the holiday, Saturday and Sunday the weekly off
    await db.leaveRequest.delete({ where: { id: r.id } });
  });

  // Daily reports only started on 2026-11-10 (REPORTS_SINCE), so these use days after that.
  it("expects no daily report and writes no scorecard", async () => {
    await addHoliday(db, org, "2026-11-20", "Company day");
    const cal = await getWorkingContext(db, org);
    const holiday = "2026-11-20"; // a Friday
    const workday = "2026-11-19"; // the Thursday before it
    const onHoliday = await dayStatus(db, { organizationId: org, workDate: holiday, timeZone: TZ, weekend: cal.calendar.weekendDays, holidays: cal.holidayDates });
    expect(onHoliday.find((r) => r.userId === user)?.expected).toBe(false);
    const onWorkday = await dayStatus(db, { organizationId: org, workDate: workday, timeZone: TZ, weekend: cal.calendar.weekendDays, holidays: cal.holidayDates });
    expect(onWorkday.find((r) => r.userId === user)?.expected).toBe(true);

    const r = await generateEndOfDay(db, { organizationId: org, workDate: holiday, timeZone: TZ, calendar: cal.calendar, holidays: cal.holidayDates });
    expect([r.expected, r.rows.length, r.missing.length]).toEqual([0, 0, 0]);
    expect(await db.dayScorecard.count({ where: { organizationId: org, workDate: holiday } })).toBe(0);
  });

  it("still scores a working day, and the score follows the saved office hours", async () => {
    const workday = "2026-11-19";
    const cal = await getWorkingContext(db, org);
    await db.attendanceRecord.create({ data: { userId: user, workDate: workday, clockIn: new Date("2026-11-19T04:00:00Z"), clockOut: new Date("2026-11-19T13:00:00Z") } }); // 09:00 to 18:00 Karachi
    await submitDailyReport(db, { organizationId: org, userId: user, workDate: workday, today: workday, summary: "Worked on the calendar all day." });
    const nine = await generateEndOfDay(db, { organizationId: org, workDate: workday, timeZone: TZ, calendar: cal.calendar, holidays: cal.holidayDates });
    const onNineHourDay = nine.rows.find((r) => r.userId === user)!;
    expect(onNineHourDay.expected).toBe(true);
    expect(onNineHourDay.lateMinutes).toBe(0); // 09:00 is on time

    // Shorten the day to 8 hours and the same 9 hours of attendance now earns the full attendance mark.
    await saveCalendar(db, org, { workStart: "09:00", workEnd: "17:30", lunchMinutes: 30, graceMinutes: 10, workDays: [1, 2, 3, 4, 5] }, user);
    const shorter = await getWorkingContext(db, org);
    const eight = await generateEndOfDay(db, { organizationId: org, workDate: workday, timeZone: TZ, calendar: shorter.calendar, holidays: shorter.holidayDates });
    const onEightHourDay = eight.rows.find((r) => r.userId === user)!;
    expect(onEightHourDay.scoreParts).toMatchObject({ attendance: 30 });
    expect(onEightHourDay.score ?? 0).toBeGreaterThanOrEqual(onNineHourDay.score ?? 0);
    await saveCalendar(db, org, { workStart: "09:00", workEnd: "18:30", lunchMinutes: 30, graceMinutes: 10, workDays: [1, 2, 3, 4, 5] }, user);
  });

  it("makes Saturday a working day when the calendar says so", async () => {
    const saturday = "2026-11-21";
    const before = await getWorkingContext(db, org);
    expect((await dayStatus(db, { organizationId: org, workDate: saturday, timeZone: TZ, weekend: before.calendar.weekendDays, holidays: before.holidayDates })).find((r) => r.userId === user)?.expected).toBe(false);
    await saveCalendar(db, org, { workStart: "09:00", workEnd: "18:30", lunchMinutes: 30, graceMinutes: 10, workDays: [1, 2, 3, 4, 5, 6] }, user);
    const after = await getWorkingContext(db, org);
    expect((await dayStatus(db, { organizationId: org, workDate: saturday, timeZone: TZ, weekend: after.calendar.weekendDays, holidays: after.holidayDates })).find((r) => r.userId === user)?.expected).toBe(true);
    await saveCalendar(db, org, { workStart: "09:00", workEnd: "18:30", lunchMinutes: 30, graceMinutes: 10, workDays: [1, 2, 3, 4, 5] }, user);
  });
});
