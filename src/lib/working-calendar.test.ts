import { describe, expect, it } from "vitest";
import {
  CalendarError, DEFAULT_CALENDAR, PAKISTAN_HOLIDAYS, calendarFrom, isWorkingDate, lateMinutes, parseWorkDays, readCalendarInput, weekendOf,
} from "./working-calendar";

const row = (over: Partial<{ workStart: string; workEnd: string; lunchMinutes: number; graceMinutes: number; workDays: string }> = {}) => ({
  workStart: "09:00", workEnd: "18:30", lunchMinutes: 30, graceMinutes: 10, workDays: "1,2,3,4,5", ...over,
});

describe("calendarFrom", () => {
  it("falls back to the built-in office hours when no row is saved", () => {
    const cal = calendarFrom(null, "Asia/Karachi");
    expect(cal.workStart).toBe(DEFAULT_CALENDAR.workStart);
    expect(cal.workDays).toEqual([1, 2, 3, 4, 5]);
    expect(cal.weekendDays).toEqual([0, 6]);
    expect(cal.fullDayMinutes).toBe(9 * 60);
  });

  it("works out a full day from the saved hours less lunch", () => {
    expect(calendarFrom(row({ workStart: "10:00", workEnd: "19:00", lunchMinutes: 60 }), "UTC").fullDayMinutes).toBe(8 * 60);
  });

  it("treats a six-day week as one working day more", () => {
    const cal = calendarFrom(row({ workDays: "1,2,3,4,5,6" }), "UTC");
    expect(cal.workDays).toEqual([1, 2, 3, 4, 5, 6]);
    expect(cal.weekendDays).toEqual([0]);
  });

  it("ignores rubbish in the working days and keeps the defaults if nothing is left", () => {
    expect(parseWorkDays("1, 9, x, 3, 3")).toEqual([1, 3]);
    expect(calendarFrom(row({ workDays: "nonsense" }), "UTC").workDays).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("isWorkingDate", () => {
  const cal = { workDays: [1, 2, 3, 4, 5] };
  it("says no on a weekly off", () => {
    expect(isWorkingDate(cal, "2026-11-14")).toBe(false); // Saturday
    expect(isWorkingDate(cal, "2026-11-15")).toBe(false); // Sunday
  });
  it("says yes on a weekday", () => expect(isWorkingDate(cal, "2026-11-13")).toBe(true));
  it("says no on a public holiday that falls on a weekday", () => {
    expect(isWorkingDate(cal, "2026-08-14", ["2026-08-14"])).toBe(false); // Independence Day, a Friday
  });
  it("counts Saturday once it is a working day", () => expect(isWorkingDate({ workDays: [1, 2, 3, 4, 5, 6] }, "2026-11-14")).toBe(true));
});

describe("lateMinutes", () => {
  const cal = { workStart: "09:00", graceMinutes: 10 };
  it("is nothing inside the grace period", () => expect(lateMinutes(cal, "09:10")).toBe(0));
  it("counts from the end of the grace period", () => expect(lateMinutes(cal, "09:25")).toBe(15));
  it("is nothing without a clock-in, because that is absent and not late", () => expect(lateMinutes(cal, null)).toBe(0));
});

describe("readCalendarInput", () => {
  const form = (o: Record<string, string>) => (k: string) => o[k] ?? "";
  const good = { workStart: "09:00", workEnd: "18:30", lunchMinutes: "30", graceMinutes: "10", workDays: "1,2,3,4,5" };

  it("reads a valid form", () => {
    expect(readCalendarInput(form(good))).toEqual({ workStart: "09:00", workEnd: "18:30", lunchMinutes: 30, graceMinutes: 10, workDays: [1, 2, 3, 4, 5] });
  });
  it("refuses a closing time before the opening time", () => {
    expect(() => readCalendarInput(form({ ...good, workEnd: "08:00" }))).toThrow(CalendarError);
  });
  it("refuses a time that is not HH:MM", () => {
    expect(() => readCalendarInput(form({ ...good, workStart: "9am" }))).toThrow(CalendarError);
  });
  it("refuses a lunch longer than the working day", () => {
    expect(() => readCalendarInput(form({ ...good, lunchMinutes: "900" }))).toThrow(CalendarError);
  });
  it("refuses a week with no working day", () => {
    expect(() => readCalendarInput(form({ ...good, workDays: "" }))).toThrow(CalendarError);
  });
});

describe("Pakistan holidays", () => {
  it("has the fixed national days in every built-in year", () => {
    for (const [year, list] of Object.entries(PAKISTAN_HOLIDAYS)) {
      const dates = list.map((h) => h.date);
      expect(dates).toContain(`${year}-08-14`); // Independence Day
      expect(dates).toContain(`${year}-03-23`); // Pakistan Day
      expect(dates).toContain(`${year}-12-25`);
      expect(new Set(dates).size).toBe(dates.length); // no date twice
      expect(dates).toEqual([...dates].sort());
    }
  });
  it("marks the moon-dependent holidays as expected, so nobody reads them as confirmed", () => {
    for (const list of Object.values(PAKISTAN_HOLIDAYS)) {
      for (const h of list) {
        if (/Eid|Ashura|Muharram|Milad/.test(h.name)) expect(h.name).toContain("expected");
      }
    }
  });
});

describe("weekendOf", () => {
  it("is whatever is left of the week", () => {
    expect(weekendOf([1, 2, 3, 4, 5])).toEqual([0, 6]);
    expect(weekendOf([0, 1, 2, 3, 4, 5, 6])).toEqual([]);
  });
});
