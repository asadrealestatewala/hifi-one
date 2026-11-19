// Portfolio health rules: what turns a project red or amber, and the reasons shown.
import { describe, expect, it } from "vitest";
import { projectHealth, type HealthInput } from "./project-health";

const base: HealthInput = { status: "ACTIVE", today: "2026-11-18", deadline: null, createdOn: "2026-11-10", openTasks: 10, overdueTasks: 0, progress: 50, lastUpdate: "2026-11-15", budgetUsedPct: null };
const h = (over: Partial<HealthInput>) => projectHealth({ ...base, ...over });

describe("projectHealth", () => {
  it("is on track with nothing late, a recent update and budget to spare", () => {
    expect(h({ budgetUsedPct: 40, deadline: "2026-12-30" })).toEqual({ health: "GREEN", reasons: [] });
  });

  it("shows on hold projects as paused instead of judging them", () => {
    expect(h({ status: "ON_HOLD", overdueTasks: 9, deadline: "2026-01-01" })).toEqual({ health: "PAUSED", reasons: ["On hold"] });
  });

  it("turns red when the deadline has passed with work open, but not once everything is done", () => {
    expect(h({ deadline: "2026-11-17" })).toEqual({ health: "RED", reasons: ["Deadline passed 1 day ago"] });
    expect(h({ deadline: "2026-11-01", progress: 100, openTasks: 0 }).health).toBe("GREEN");
  });

  it("turns amber when the deadline is within 7 days and under 80% is done", () => {
    expect(h({ deadline: "2026-11-25", progress: 60 })).toEqual({ health: "AMBER", reasons: ["Deadline in 7 days, 60% done"] });
    expect(h({ deadline: "2026-11-18", progress: 10 }).reasons).toEqual(["Deadline in 0 days, 10% done"]);
    expect(h({ deadline: "2026-11-25", progress: 80 }).health).toBe("GREEN");
    expect(h({ deadline: "2026-11-26", progress: 10 }).health).toBe("GREEN");
  });

  it("counts overdue tasks: one or two is amber, three or a quarter of the open ones is red", () => {
    expect(h({ overdueTasks: 1 })).toEqual({ health: "AMBER", reasons: ["1 task overdue"] });
    expect(h({ overdueTasks: 2 }).health).toBe("AMBER");
    expect(h({ overdueTasks: 3, openTasks: 40 })).toEqual({ health: "RED", reasons: ["3 tasks overdue"] });
    expect(h({ overdueTasks: 2, openTasks: 4 }).health).toBe("RED"); // half the open work is late
  });

  it("uses budget only when the viewer may see it: 80% is amber, over 100% is red", () => {
    expect(h({ budgetUsedPct: 80 })).toEqual({ health: "AMBER", reasons: ["80% of budget used"] });
    expect(h({ budgetUsedPct: 100 }).health).toBe("AMBER");
    expect(h({ budgetUsedPct: 112 })).toEqual({ health: "RED", reasons: ["Over budget (112% used)"] });
    expect(h({ budgetUsedPct: null }).health).toBe("GREEN"); // no cost rights: budget never shows
  });

  it("flags a project nobody has posted an update on for 14 days", () => {
    expect(h({ lastUpdate: "2026-11-04" })).toEqual({ health: "AMBER", reasons: ["No update for 14 days"] });
    expect(h({ lastUpdate: "2026-11-05" }).health).toBe("GREEN");
    expect(h({ lastUpdate: null, createdOn: "2026-11-01" }).reasons).toEqual(["No update posted yet"]);
    expect(h({ lastUpdate: null, createdOn: "2026-11-12" }).health).toBe("GREEN"); // a new project gets two weeks
  });

  it("lists every reason, red ones first", () => {
    expect(h({ deadline: "2026-11-10", overdueTasks: 1, openTasks: 20, lastUpdate: "2026-10-01" })).toEqual({ health: "RED", reasons: ["Deadline passed 8 days ago", "1 task overdue", "No update for 48 days"] });
  });
});
