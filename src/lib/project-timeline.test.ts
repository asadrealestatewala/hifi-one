import { describe, expect, it } from "vitest";
import { buildTimeline, timelineLinks } from "./project-timeline";

const d = (s: string) => new Date(`${s}T10:00:00Z`);
const task = (id: string, over: Partial<Parameters<typeof buildTimeline>[0]["tasks"][number]> = {}) => ({ id, title: id, status: "TODO", createdAt: d("2026-10-01"), dueDate: d("2026-10-10"), completedAt: null, ...over });

describe("buildTimeline", () => {
  it("places bars between creation and due date inside the shown range", () => {
    const t = buildTimeline({ tasks: [task("a"), task("b", { createdAt: d("2026-10-05"), dueDate: d("2026-10-20") })], today: "2026-10-08" });
    expect(t).toMatchObject({ from: "2026-10-01", to: "2026-10-20", days: 20 });
    expect(t.bars[0]).toMatchObject({ id: "a", start: "2026-10-01", end: "2026-10-10", left: 0 });
    expect(t.bars[0].width).toBeCloseTo(50, 1);
    expect(t.bars[1].left).toBeCloseTo(20, 1);
    expect(t.todayPct).toBeCloseTo(35, 1);
    for (const b of t.bars) expect(b.left + b.width).toBeLessThanOrEqual(100.0001);
  });
  it("marks overdue open tasks, ends done tasks at completion, and keeps undated tasks apart without inventing dates", () => {
    const t = buildTimeline({ tasks: [task("late", { dueDate: d("2026-10-03") }), task("done", { status: "DONE", completedAt: d("2026-10-04"), dueDate: d("2026-10-30") }), task("none", { dueDate: null })], today: "2026-10-12" });
    expect(t.bars.find((b) => b.id === "late")?.overdue).toBe(true);
    expect(t.bars.find((b) => b.id === "done")).toMatchObject({ end: "2026-10-04", overdue: false, done: true });
    expect(t.undated).toEqual([{ id: "none", title: "none", status: "TODO" }]);
  });
  it("copes with no tasks, and with a due date before the creation date", () => {
    const empty = buildTimeline({ tasks: [], today: "2026-10-12" });
    expect(empty).toMatchObject({ bars: [], days: 1, from: "2026-10-12" });
    const odd = buildTimeline({ tasks: [task("x", { createdAt: d("2026-10-10"), dueDate: d("2026-10-05") })], today: "2026-10-12" });
    expect(odd.bars[0]).toMatchObject({ start: "2026-10-05", end: "2026-10-05" });
  });
  it("shows the deadline and milestone markers", () => {
    const t = buildTimeline({ tasks: [task("a")], today: "2026-10-02", deadline: d("2026-10-30"), milestones: [{ name: "Design", dueDate: "2026-10-15" }, { name: "Later", dueDate: null }] });
    expect(t.markers.map((m) => m.label)).toEqual(["Deadline", "Design"]);
    expect(t.to).toBe("2026-10-30");
  });
});

describe("buildTimeline with start dates", () => {
  it("starts a bar at the task's start date when one is set, and marks it", () => {
    const t = buildTimeline({ tasks: [task("a", { startDate: d("2026-10-06"), dueDate: d("2026-10-09") }), task("b")], today: "2026-10-02" });
    const a = t.bars.find((b) => b.id === "a")!;
    expect(a).toMatchObject({ start: "2026-10-06", end: "2026-10-09", startSet: true, due: "2026-10-09" });
    expect(t.bars.find((b) => b.id === "b")!.startSet).toBe(false);
  });
  it("links a task to the dated work it waits for, and marks the link late when the waiting task starts first", () => {
    const t = buildTimeline({ tasks: [
      task("design", { dueDate: d("2026-10-10") }),
      task("build", { startDate: d("2026-10-08"), dueDate: d("2026-10-20"), blockedBy: ["design"] }),
      task("test", { startDate: d("2026-10-21"), dueDate: d("2026-10-25"), blockedBy: ["build", "undated", "gone"] }),
      task("undated", { dueDate: null }),
    ], today: "2026-10-05" });
    expect(t.links).toEqual([{ from: "design", to: "build", late: true }, { from: "build", to: "test", late: false }]);
    const done = timelineLinks([{ id: "a", start: "2026-10-01", due: "2026-10-10", done: true }, { id: "b", start: "2026-10-02", due: "2026-10-12", done: false }], new Map([["b", ["a"]]]));
    expect(done).toEqual([{ from: "a", to: "b", late: false }]); // finished work never makes a link late
  });
});
