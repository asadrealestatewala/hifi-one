import { describe, expect, it } from "vitest";
import { resolveTab } from "./tabs";

const keys = ["overview", "tasks", "updates", "files", "time", "settings"];

describe("project page tabs", () => {
  it("opens the tab named by a hash or a ?tab value", () => {
    expect(resolveTab("#tasks", keys)).toBe("tasks");
    expect(resolveTab("settings", keys)).toBe("settings");
    expect(resolveTab("#requests", keys)).toBe("overview"); // client requests sit on the overview
  });
  it("maps older section anchors to the tab that holds them", () => {
    expect(resolveTab("#deliverables", keys)).toBe("updates");
    expect(resolveTab("assets", keys)).toBe("files");
    expect(resolveTab("#milestones", keys)).toBe("tasks");
    expect(resolveTab("money", keys)).toBe("time");
  });
  it("ignores tabs the person cannot see and unknown values", () => {
    expect(resolveTab("#meetings", keys)).toBeNull();
    expect(resolveTab("#nope", keys)).toBeNull();
    expect(resolveTab(undefined, keys)).toBeNull();
    expect(resolveTab("settings", ["overview", "tasks"])).toBeNull();
  });
});
