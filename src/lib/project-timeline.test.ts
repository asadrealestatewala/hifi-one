import { describe, expect, it } from "vitest";
import { buildTimeline } from "./project-timeline";

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
