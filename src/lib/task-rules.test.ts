import { describe, expect, it } from "vitest";
import { nextDue, openBlockers, wouldCycle } from "./task-rules";

describe("wouldCycle", () => {
  const t = (id: string, blockedBy: string[] = []) => ({ id, blockedBy });
  it("detects direct and long loops, allows chains and diamonds", () => {
    expect(wouldCycle([t("a"), t("b", ["a"])], "a", ["b"])).toBe(true);
    expect(wouldCycle([t("a"), t("b", ["a"]), t("c", ["b"]), t("d", ["c"])], "a", ["d"])).toBe(true);
    expect(wouldCycle([t("a"), t("b"), t("c", ["a"]), t("d", ["b", "c"])], "d", ["a"])).toBe(false);
    expect(wouldCycle([t("a"), t("b"), t("c", ["a", "b"])], "c", ["a"])).toBe(false);
  });
});

describe("openBlockers", () => {
  it("lists only the blockers that are not Done", () => {
    const m = new Map([["a", { status: "DONE", title: "A" }], ["b", { status: "TODO", title: "B" }]]);
    expect(openBlockers(["a", "b", "gone"], m)).toEqual([{ status: "TODO", title: "B" }]);
  });
});

describe("nextDue", () => {
  const d = (s: string) => new Date(s + "T00:00:00Z");
  it("adds a day, a week or a month from the due date", () => {
    expect(nextDue(d("2026-03-10"), "DAILY").toISOString().slice(0, 10)).toBe("2026-03-11");
    expect(nextDue(d("2026-03-10"), "WEEKLY").toISOString().slice(0, 10)).toBe("2026-03-17");
    expect(nextDue(d("2026-03-10"), "MONTHLY").toISOString().slice(0, 10)).toBe("2026-04-10");
  });
  it("clamps month ends and rolls over the year", () => {
    expect(nextDue(d("2026-01-31"), "MONTHLY").toISOString().slice(0, 10)).toBe("2026-02-28");
    expect(nextDue(d("2028-01-31"), "MONTHLY").toISOString().slice(0, 10)).toBe("2028-02-29");
    expect(nextDue(d("2026-12-15"), "MONTHLY").toISOString().slice(0, 10)).toBe("2027-01-15");
  });
  it("counts from today when the task had no due date", () => {
    expect(nextDue(null, "WEEKLY", d("2026-05-01")).toISOString().slice(0, 10)).toBe("2026-05-08");
  });
});

describe("parseEstimate", () => {
  it("reads hours as typed and refuses nonsense", async () => {
    const { parseEstimate } = await import("./task-rules");
    expect(parseEstimate("")).toEqual({ ok: true, value: null });
    expect(parseEstimate(" 3 ")).toEqual({ ok: true, value: "3" });
    expect(parseEstimate("1,5")).toEqual({ ok: true, value: "1.5" });
    expect(parseEstimate("0")).toEqual({ ok: false });
    expect(parseEstimate("-2")).toEqual({ ok: false });
    expect(parseEstimate("1000")).toEqual({ ok: false });
    expect(parseEstimate("two")).toEqual({ ok: false });
  });
});
