import { describe, expect, it } from "vitest";
import { countdown, deadlineAt, deadlineText, finishedText, readDueTime, spanText, taskTimes } from "./task-deadline";

const CAL = { timezone: "Asia/Karachi", workEnd: "18:30" };
const due = new Date("2026-11-24T00:00:00.000Z");

describe("task deadline", () => {
  it("is the end of the office day in company time when no time is set", () => {
    expect(deadlineAt(due, null, CAL)?.toISOString()).toBe("2026-11-24T13:30:00.000Z"); // 6:30 PM Karachi = 13:30 UTC
  });
  it("uses the task's own time of day when set, and ignores a broken one", () => {
    expect(deadlineAt(due, "15:00", CAL)?.toISOString()).toBe("2026-11-24T10:00:00.000Z");
    expect(deadlineAt(due, "25:99", CAL)?.toISOString()).toBe("2026-11-24T13:30:00.000Z");
  });
  it("has no deadline without a due date", () => {
    expect(deadlineAt(null, "15:00", CAL)).toBeNull();
  });
  it("reads a due time from a form: empty clears it, junk is refused", () => {
    expect(readDueTime("")).toEqual({ ok: true, value: null });
    expect(readDueTime("09:30")).toEqual({ ok: true, value: "09:30" });
    expect(readDueTime("9:30pm")).toEqual({ ok: false });
  });
});

describe("countdown", () => {
  const at = new Date("2026-11-24T13:30:00.000Z");
  const minus = (m: number) => new Date(at.getTime() - m * 60_000);
  it("is green with plenty of time left", () => {
    expect(countdown(at, minus(200), minus(400))).toEqual({ tone: "green", text: "3 h 20 m left", msLeft: 200 * 60_000 });
  });
  it("turns orange in the last two hours", () => {
    expect(countdown(at, minus(120), minus(2000)).tone).toBe("orange");
    expect(countdown(at, minus(121), minus(200)).tone).toBe("green");
  });
  it("turns orange in the last quarter of the time given, even with more than two hours left", () => {
    // given 16 hours, 3 hours 50 minutes left = under a quarter
    expect(countdown(at, minus(230), minus(960)).tone).toBe("orange");
    expect(countdown(at, minus(250), minus(960)).tone).toBe("green");
  });
  it("turns red in the last half hour", () => {
    expect(countdown(at, minus(30), minus(400)).tone).toBe("red");
    expect(countdown(at, minus(5), minus(400)).text).toBe("5 m left");
  });
  it("shows Overdue with how late it is once time runs out", () => {
    expect(countdown(at, minus(-65), minus(400))).toMatchObject({ tone: "overdue", text: "Overdue 1 h 05 m" });
    expect(countdown(at, at).tone).toBe("overdue");
  });
  it("writes spans in days, hours and minutes", () => {
    expect(spanText(30_000)).toBe("under a minute");
    expect(spanText(45 * 60_000)).toBe("45 m");
    expect(spanText(2 * 60 * 60_000)).toBe("2 h");
    expect(spanText((2 * 1440 + 4 * 60 + 10) * 60_000)).toBe("2 days 4 h");
    expect(spanText(1440 * 60_000)).toBe("1 day");
  });
  it("says whether a finished task made its deadline", () => {
    expect(finishedText(at, minus(10))).toEqual({ onTime: true, text: "Done on time" });
    expect(finishedText(at, minus(-90))).toEqual({ onTime: false, text: "Done 1 h 30 m late" });
  });
  it("names the deadline relative to today in company time", () => {
    const morning = new Date("2026-11-24T05:00:00.000Z");
    expect(deadlineText(at, "Asia/Karachi", morning)).toBe("Today 6:30 PM");
    expect(deadlineText(at, "Asia/Karachi", new Date("2026-11-23T05:00:00.000Z"))).toBe("Tomorrow 6:30 PM");
    expect(deadlineText(at, "Asia/Karachi", new Date("2026-11-20T05:00:00.000Z"))).toBe("Tue 24 Nov, 6:30 PM");
  });
});

describe("task times", () => {
  const base = { createdAt: new Date("2026-11-24T04:00:00Z"), assignedAt: new Date("2026-11-24T05:00:00Z"), startedAt: null, completedAt: null, assigneeId: "u1" };
  const now = new Date("2026-11-24T07:30:00Z");
  it("shows how long an assigned task has waited to be started", () => {
    expect(taskTimes({ ...base, status: "TODO" }, "Asia/Karachi", now)).toEqual({ assigned: "24 Nov, 10:00 am", started: null, taken: "Not started for 2 h 30 m" });
  });
  it("shows how long work has been going, and the total once done", () => {
    const started = { ...base, startedAt: new Date("2026-11-24T06:00:00Z") };
    expect(taskTimes({ ...started, status: "IN_PROGRESS" }, "Asia/Karachi", now).taken).toBe("Working for 1 h 30 m");
    expect(taskTimes({ ...started, status: "DONE", completedAt: new Date("2026-11-24T09:00:00Z") }, "Asia/Karachi", now).taken).toBe("Took 3 h");
  });
  it("falls back to the creation time when the assignment time is unknown, and shows nothing for an unassigned task", () => {
    expect(taskTimes({ ...base, assignedAt: null, status: "TODO" }, "Asia/Karachi", now).assigned).toBe("24 Nov, 9:00 am");
    expect(taskTimes({ ...base, assigneeId: null, status: "TODO" }, "Asia/Karachi", now)).toEqual({ assigned: null, started: null, taken: null });
  });
});
