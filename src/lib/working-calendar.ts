// The working calendar: the one place that says when the company works. Office hours, which weekdays are working
// days, lunch, the grace period before a clock-in counts as late, and the public holidays. Attendance, leave,
// daily reports, scorecards, the sales quest streak, payroll and the scheduled reminders all read it, so a change
// in Company settings → Working calendar moves every one of them together. The time zone stays on CompanyProfile,
// which already owns it. Free of Next.js imports so it can be tested against the database.
import type { PrismaClient } from "@prisma/client";
import { isDateString } from "./hr-rules";

type Db = PrismaClient;
export class CalendarError extends Error {}

// Decision 2026-11-08 (Asad): 9:00 to 18:30 Pakistan time with a 30 minute lunch, so a full day is 9 hours.
// Monday to Friday; Saturday is off until an administrator says otherwise.
export const DEFAULT_CALENDAR = { workStart: "09:00", workEnd: "18:30", lunchMinutes: 30, graceMinutes: 10, workDays: [1, 2, 3, 4, 5] } as const;
export const DEFAULT_TIMEZONE = "Asia/Karachi";

export type Calendar = {
  timezone: string;
  workStart: string;
  workEnd: string;
  lunchMinutes: number;
  graceMinutes: number;
  workDays: number[]; // 0 = Sunday
  weekendDays: number[]; // the rest of the week
  fullDayMinutes: number; // office hours less lunch: what a full attendance day is worth
};

export const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

export const minutesOfTime = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
export const isTimeString = (t: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t);

export function parseWorkDays(raw: string): number[] {
  const days = [...new Set(raw.split(",").map((s) => s.trim()).filter((s) => s !== "").map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))];
  return days.sort((a, b) => a - b);
}

export const weekendOf = (workDays: readonly number[]) => [0, 1, 2, 3, 4, 5, 6].filter((d) => !workDays.includes(d));

export function calendarFrom(row: { workStart: string; workEnd: string; lunchMinutes: number; graceMinutes: number; workDays: string } | null, timezone: string): Calendar {
  const workStart = row?.workStart ?? DEFAULT_CALENDAR.workStart;
  const workEnd = row?.workEnd ?? DEFAULT_CALENDAR.workEnd;
  const lunchMinutes = row?.lunchMinutes ?? DEFAULT_CALENDAR.lunchMinutes;
  const workDays = row ? parseWorkDays(row.workDays) : [...DEFAULT_CALENDAR.workDays];
  const days = workDays.length > 0 ? workDays : [...DEFAULT_CALENDAR.workDays];
  return {
    timezone, workStart, workEnd, lunchMinutes,
    graceMinutes: row?.graceMinutes ?? DEFAULT_CALENDAR.graceMinutes,
    workDays: days, weekendDays: weekendOf(days),
    fullDayMinutes: Math.max(0, minutesOfTime(workEnd) - minutesOfTime(workStart) - lunchMinutes),
  };
}

export const dayOfWeek = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();

// Is this date a day the company works? Weekly offs and holidays both say no.
export const isWorkingDate = (cal: Pick<Calendar, "workDays">, date: string, holidays: readonly string[] = []) =>
  cal.workDays.includes(dayOfWeek(date)) && !holidays.includes(date);

// Minutes late, counting the grace period. An empty clock-in is not late; it is absent.
export const lateMinutes = (cal: Pick<Calendar, "workStart" | "graceMinutes">, clockIn: string | null) =>
  clockIn ? Math.max(0, minutesOfTime(clockIn) - minutesOfTime(cal.workStart) - cal.graceMinutes) : 0;

// ---------- Reads ----------

export async function getCalendar(db: Db, organizationId: string): Promise<Calendar> {
  const [row, profile] = await Promise.all([
    db.workingCalendar.findUnique({ where: { organizationId } }),
    db.companyProfile.findFirst({ where: { organizationId, isDefault: true }, select: { timezone: true } }),
  ]);
  return calendarFrom(row, profile?.timezone || DEFAULT_TIMEZONE);
}

export type Holiday = { date: string; name: string };
export type HolidayRow = Holiday & { id: string };

// Holidays in date order. `from` and `to` are inclusive YYYY-MM-DD; without them every holiday on record.
export async function getHolidays(db: Db, organizationId: string, from?: string, to?: string): Promise<HolidayRow[]> {
  return db.publicHoliday.findMany({
    where: { organizationId, ...(from || to ? { date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}) },
    orderBy: { date: "asc" }, select: { id: true, date: true, name: true },
  });
}

export const holidayDates = (list: readonly Holiday[]) => list.map((h) => h.date);

// Everything a day-by-day calculation needs, in one round trip.
export async function getWorkingContext(db: Db, organizationId: string, from?: string, to?: string): Promise<{ calendar: Calendar; holidays: HolidayRow[]; holidayDates: string[] }> {
  const [calendar, holidays] = await Promise.all([getCalendar(db, organizationId), getHolidays(db, organizationId, from, to)]);
  return { calendar, holidays, holidayDates: holidayDates(holidays) };
}

// ---------- Writes ----------

export type CalendarInput = { workStart: string; workEnd: string; lunchMinutes: number; graceMinutes: number; workDays: number[] };

export function readCalendarInput(get: (k: string) => string): CalendarInput {
  const workStart = get("workStart").trim();
  const workEnd = get("workEnd").trim();
  if (!isTimeString(workStart) || !isTimeString(workEnd)) throw new CalendarError("Write the office hours as HH:MM, for example 09:00.");
  if (minutesOfTime(workEnd) <= minutesOfTime(workStart)) throw new CalendarError("The closing time must be after the opening time.");
  const num = (k: string, label: string, max: number) => {
    const n = Number(get(k).trim() || "0");
    if (!Number.isInteger(n) || n < 0 || n > max) throw new CalendarError(`${label} must be a whole number of minutes between 0 and ${max}.`);
    return n;
  };
  const lunchMinutes = num("lunchMinutes", "Lunch", minutesOfTime(workEnd) - minutesOfTime(workStart));
  const graceMinutes = num("graceMinutes", "The grace period", 120);
  const workDays = parseWorkDays(get("workDays"));
  if (workDays.length === 0) throw new CalendarError("Choose at least one working day.");
  return { workStart, workEnd, lunchMinutes, graceMinutes, workDays };
}

export async function saveCalendar(db: Db, organizationId: string, input: CalendarInput, updatedById: string) {
  const data = { ...input, workDays: input.workDays.join(",") };
  return db.workingCalendar.upsert({ where: { organizationId }, create: { organizationId, ...data, updatedById }, update: { ...data, updatedById } });
}

export async function addHoliday(db: Db, organizationId: string, date: string, name: string) {
  if (!isDateString(date)) throw new CalendarError("Write the date as YYYY-MM-DD.");
  const label = name.trim();
  if (label.length < 2) throw new CalendarError("Give the holiday a name, for example Independence Day.");
  const existing = await db.publicHoliday.findUnique({ where: { organizationId_date: { organizationId, date } } });
  if (existing) throw new CalendarError(`${date} is already on the list as ${existing.name}.`);
  return db.publicHoliday.create({ data: { organizationId, date, name: label } });
}

export async function removeHoliday(db: Db, organizationId: string, id: string) {
  const row = await db.publicHoliday.findFirst({ where: { id, organizationId } });
  if (!row) throw new CalendarError("That holiday is not on the list.");
  await db.publicHoliday.delete({ where: { id } });
  return row;
}

// ---------- Pakistan public holidays ----------

// The gazetted holidays. The fixed ones are certain; the Islamic ones move with the moon and are marked "expected"
// until the Government of Pakistan notifies the dates, which is usually a few weeks before. An administrator can
// correct any date on the Working calendar page.
export const PAKISTAN_HOLIDAYS: Record<string, Holiday[]> = {
  "2026": [
    { date: "2026-02-05", name: "Kashmir Solidarity Day" },
    { date: "2026-03-20", name: "Eid-ul-Fitr (expected)" },
    { date: "2026-03-21", name: "Eid-ul-Fitr (expected)" },
    { date: "2026-03-22", name: "Eid-ul-Fitr (expected)" },
    { date: "2026-03-23", name: "Pakistan Day" },
    { date: "2026-05-01", name: "Labour Day" },
    { date: "2026-05-27", name: "Eid-ul-Azha (expected)" },
    { date: "2026-05-28", name: "Eid-ul-Azha (expected)" },
    { date: "2026-05-29", name: "Eid-ul-Azha (expected)" },
    { date: "2026-06-25", name: "Ashura, 9 Muharram (expected)" },
    { date: "2026-06-26", name: "Ashura, 10 Muharram (expected)" },
    { date: "2026-08-14", name: "Independence Day" },
    { date: "2026-08-26", name: "Eid Milad-un-Nabi (expected)" },
    { date: "2026-12-25", name: "Quaid-e-Azam Day and Christmas" },
  ],
  "2027": [
    { date: "2027-02-05", name: "Kashmir Solidarity Day" },
    { date: "2027-03-09", name: "Eid-ul-Fitr (expected)" },
    { date: "2027-03-10", name: "Eid-ul-Fitr (expected)" },
    { date: "2027-03-11", name: "Eid-ul-Fitr (expected)" },
    { date: "2027-03-23", name: "Pakistan Day" },
    { date: "2027-05-01", name: "Labour Day" },
    { date: "2027-05-17", name: "Eid-ul-Azha (expected)" },
    { date: "2027-05-18", name: "Eid-ul-Azha (expected)" },
    { date: "2027-05-19", name: "Eid-ul-Azha (expected)" },
    { date: "2027-06-14", name: "Ashura, 9 Muharram (expected)" },
    { date: "2027-06-15", name: "Ashura, 10 Muharram (expected)" },
    { date: "2027-08-14", name: "Independence Day" },
    { date: "2027-08-15", name: "Eid Milad-un-Nabi (expected)" },
    { date: "2027-12-25", name: "Quaid-e-Azam Day and Christmas" },
  ],
};

export const HOLIDAY_YEARS = Object.keys(PAKISTAN_HOLIDAYS).sort();

// Adds the year's Pakistan holidays, keeping any date already on the list (an administrator's own correction wins).
export async function seedPakistanHolidays(db: Db, organizationId: string, year: string): Promise<{ added: Holiday[]; kept: number }> {
  const list = PAKISTAN_HOLIDAYS[year];
  if (!list) throw new CalendarError(`Pakistan holidays are only built in for ${HOLIDAY_YEARS.join(" and ")}. Add other years by hand.`);
  const have = new Set((await getHolidays(db, organizationId, `${year}-01-01`, `${year}-12-31`)).map((h) => h.date));
  const added = list.filter((h) => !have.has(h.date));
  if (added.length > 0) await db.publicHoliday.createMany({ data: added.map((h) => ({ organizationId, date: h.date, name: h.name })) });
  return { added, kept: list.length - added.length };
}
