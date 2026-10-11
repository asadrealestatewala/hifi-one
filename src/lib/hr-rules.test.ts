import { describe, expect, it } from "vitest";
import { dateInZone, fmtMinutes, isDateString, leaveRemaining, rangesOverlap, workedMinutes, workingDays } from "./hr-rules";

describe("workingDays", () => {
  it("skips weekends (Mon 2026-10-12 to Sun 2026-10-18 is 5 days)", () => {
    expect(workingDays("2026-10-12", "2026-10-18")).toBe(5);
  });
  it("a single weekday is 1, a single Saturday is 0", () => {
    expect(workingDays("2026-10-14", "2026-10-14")).toBe(1);
    expect(workingDays("2026-10-17", "2026-10-17")).toBe(0);
  });
  it("skips listed holidays", () => {
    expect(workingDays("2026-10-12", "2026-10-16", ["2026-10-14"])).toBe(4);
  });
  it("end before start is zero", () => {
    expect(workingDays("2026-10-14", "2026-10-13")).toBe(0);
  });
});

describe("date validation and overlap", () => {
  it("accepts real dates only", () => {
    expect(isDateString("2026-10-14")).toBe(true);
    expect(isDateString("2026-02-30")).toBe(false);
    expect(isDateString("14/10/2026")).toBe(false);
  });
  it("detects overlapping ranges including touching days", () => {
    expect(rangesOverlap({ start: "2026-10-12", end: "2026-10-14" }, { start: "2026-10-14", end: "2026-10-16" })).toBe(true);
    expect(rangesOverlap({ start: "2026-10-12", end: "2026-10-13" }, { start: "2026-10-14", end: "2026-10-16" })).toBe(false);
  });
});

describe("leave balance", () => {
  it("subtracts approved and pending", () => {
    expect(leaveRemaining(14, 5, 2)).toEqual({ remaining: 9, available: 7 });
  });
});

describe("attendance time", () => {
  const at = (h: number, m = 0) => new Date(Date.UTC(2026, 9, 12, h, m));
  it("subtracts breaks from attendance", () => {
    const r = workedMinutes({ clockIn: at(9), clockOut: at(17) }, [{ startAt: at(13), endAt: at(13, 45) }]);
    expect(r).toEqual({ attendance: 480, breaks: 45, worked: 435 });
    expect(fmtMinutes(435)).toBe("7h 15m");
  });
  it("an open record counts up to now, including an open break", () => {
    const r = workedMinutes({ clockIn: at(9), clockOut: null }, [{ startAt: at(10, 30), endAt: null }], at(11));
    expect(r).toEqual({ attendance: 120, breaks: 30, worked: 90 });
  });
});

describe("dateInZone", () => {
  it("uses the company timezone, not UTC", () => {
    const t = new Date("2026-10-10T22:30:00Z"); // already 11 Oct in Karachi (UTC+5)
    expect(dateInZone(t, "Asia/Karachi")).toBe("2026-10-11");
    expect(dateInZone(t, "UTC")).toBe("2026-10-10");
  });
});
