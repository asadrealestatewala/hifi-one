import { describe, expect, it } from "vitest";
import { dayItems, dayKindFor, type MyDay } from "./my-day";

const CAL = { workDays: [1, 2, 3, 4, 5] };
const base = (over: Partial<Omit<MyDay, "items">> = {}): Omit<MyDay, "items"> => ({
  date: "2026-11-12", // a Thursday
  kind: { working: true, reason: null },
  clock: { state: "WORKING", since: new Date("2026-11-12T04:00:00Z"), workedMinutes: 120, breaks: 0 },
  report: "SENT", circulars: 0, tasks: { dueToday: 0, overdue: 0, open: 0 }, meetings: [],
  ...over,
});
const all = { canAttendance: true, canReport: true };
const ids = (d: Omit<MyDay, "items">, o = all) => dayItems(d, o).map((i) => i.id);

describe("dayKindFor", () => {
  it("is a working day on a weekday with nothing in the way", () => {
    expect(dayKindFor({ date: "2026-11-12", calendar: CAL })).toEqual({ working: true, reason: null });
  });
  it("names the weekly off", () => {
    expect(dayKindFor({ date: "2026-11-14", calendar: CAL }).reason).toContain("Saturday");
  });
  it("names the holiday, which wins over the weekday", () => {
    expect(dayKindFor({ date: "2026-11-12", calendar: CAL, holidayName: "Independence Day" }).reason).toContain("Independence Day");
  });
  it("puts approved leave above everything, because the person is not here", () => {
    const k = dayKindFor({ date: "2026-11-12", calendar: CAL, holidayName: "Independence Day", onLeave: "Annual" });
    expect(k.working).toBe(false);
    expect(k.reason).toContain("Annual");
  });
});

describe("what is still to do", () => {
  it("asks you to clock in first", () => {
    expect(ids(base({ clock: { state: "NOT_STARTED", since: null, workedMinutes: 0, breaks: 0 } }))[0]).toBe("clock-in");
  });
  it("asks you to clock out while you are working", () => expect(ids(base())).toContain("clock-out"));
  it("says nothing about the clock once you have clocked out", () => {
    expect(ids(base({ clock: { state: "FINISHED", since: null, workedMinutes: 480, breaks: 30 } }))).toEqual([]);
  });
  it("asks for the daily report only when it is missing", () => {
    expect(ids(base({ report: "MISSING" }))).toContain("report");
    expect(ids(base({ report: "LATE" }))).not.toContain("report");
  });
  it("asks for nothing on a day that is not a working day, apart from what others sent you", () => {
    const off = base({ kind: { working: false, reason: "Saturday is a weekly off." }, clock: { state: "NOT_STARTED", since: null, workedMinutes: 0, breaks: 0 }, report: "NOT_EXPECTED", circulars: 2 });
    expect(ids(off)).toEqual(["circulars"]);
  });
  it("leaves the clock and the report alone for someone without attendance", () => {
    const d = base({ clock: { state: "NOT_STARTED", since: null, workedMinutes: 0, breaks: 0 }, report: "MISSING", tasks: { dueToday: 1, overdue: 0, open: 3 } });
    expect(ids(d, { canAttendance: false, canReport: false })).toEqual(["tasks-today"]);
  });
  it("puts overdue tasks above tasks due today, and marks them", () => {
    const d = base({ tasks: { dueToday: 2, overdue: 3, open: 9 } });
    const items = dayItems(d, all);
    const overdue = items.find((i) => i.id === "tasks-overdue")!;
    expect(items.findIndex((i) => i.id === "tasks-overdue")).toBeLessThan(items.findIndex((i) => i.id === "tasks-today"));
    expect(overdue.tone).toBe("danger");
    expect(overdue.text).toContain("3");
  });
  it("says a live meeting is live", () => {
    const d = base({ meetings: [{ id: "m1", title: "Client review", at: null, live: true }] });
    expect(dayItems(d, all).find((i) => i.id === "meeting-m1")?.text).toContain("live now");
  });
  it("writes one and many the right way round", () => {
    expect(dayItems(base({ circulars: 1 }), all)[1].text).toContain("1 circular to confirm");
    expect(dayItems(base({ circulars: 2 }), all)[1].text).toContain("2 circulars to confirm");
  });
});
