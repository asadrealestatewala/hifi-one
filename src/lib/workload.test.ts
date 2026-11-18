import { describe, expect, it } from "vitest";
import { capacityHours, loadLevel, weekStart, windowDates } from "./workload";

const CAL = { workDays: [1, 2, 3, 4, 5, 6], fullDayMinutes: 540 }; // Mon–Sat, 9 hours

describe("workload rules", () => {
  it("counts working days only, less holidays and approved leave", () => {
    const week = windowDates("2026-11-18"); // Wed 18 to Tue 24
    expect(week).toEqual(["2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21", "2026-11-22", "2026-11-23", "2026-11-24"]);
    expect(capacityHours(CAL, week, [], [])).toBe(54); // 6 working days (Sunday off)
    expect(capacityHours(CAL, week, ["2026-11-19"], [])).toBe(45);
    expect(capacityHours(CAL, week, ["2026-11-19"], [{ startDate: "2026-11-23", endDate: "2026-12-02" }])).toBe(27);
    expect(capacityHours(CAL, week, [], [{ startDate: "2026-11-01", endDate: "2026-11-30" }])).toBe(0);
  });

  it("says who is over, busy, has room or away", () => {
    expect(loadLevel(60, 54)).toEqual({ level: "OVER", percent: 111 });
    expect(loadLevel(44, 54)).toEqual({ level: "BUSY", percent: 81 });
    expect(loadLevel(10, 54)).toEqual({ level: "OK", percent: 19 });
    expect(loadLevel(0, 0)).toEqual({ level: "AWAY", percent: null });
    expect(loadLevel(3, 0)).toEqual({ level: "OVER", percent: null }); // work due while away
    expect(loadLevel(0, 45, 3)).toEqual({ level: "UNSIZED", percent: 0 }); // tasks due, none estimated
    expect(loadLevel(5, 45, 3).level).toBe("OK");
  });

  it("starts the week on Monday", () => {
    expect(weekStart("2026-11-18")).toBe("2026-11-16");
    expect(weekStart("2026-11-16")).toBe("2026-11-16");
    expect(weekStart("2026-11-22")).toBe("2026-11-16"); // Sunday belongs to the week that began on Monday
  });
});
