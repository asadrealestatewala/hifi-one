import { describe, expect, it } from "vitest";
import { canCompleteProject, isOverdue, projectProgress } from "./project-rules";

describe("project rules", () => {
  it("progress is the share of done tasks", () => {
    expect(projectProgress([])).toBe(0);
    expect(projectProgress([{ status: "DONE" }, { status: "TODO" }, { status: "REVIEW" }, { status: "DONE" }])).toBe(50);
  });
  it("cannot complete with open tasks or no tasks", () => {
    expect(canCompleteProject([]).ok).toBe(false);
    const r = canCompleteProject([{ status: "DONE" }, { status: "IN_PROGRESS" }]);
    expect(r.ok).toBe(false);
    expect(canCompleteProject([{ status: "DONE" }]).ok).toBe(true);
  });
  it("overdue ignores done tasks and tasks without a due date", () => {
    const past = new Date(Date.now() - 86400000);
    expect(isOverdue({ status: "TODO", dueDate: past })).toBe(true);
    expect(isOverdue({ status: "DONE", dueDate: past })).toBe(false);
    expect(isOverdue({ status: "TODO", dueDate: null })).toBe(false);
  });
});
