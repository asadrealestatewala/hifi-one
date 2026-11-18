import { describe, expect, it } from "vitest";
import { workGroupOf } from "./my-work";

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

describe("workGroupOf", () => {
  const today = "2026-11-18";
  it("puts each due date in the group a person plans by", () => {
    expect(workGroupOf(null, today)).toBe("nodate");
    expect(workGroupOf(d("2026-11-17"), today)).toBe("overdue");
    expect(workGroupOf(d("2026-11-18"), today)).toBe("today");
    expect(workGroupOf(d("2026-11-19"), today)).toBe("week");
    expect(workGroupOf(d("2026-11-24"), today)).toBe("week"); // the 6th day ahead
    expect(workGroupOf(d("2026-11-25"), today)).toBe("later"); // a week from today
  });
});
