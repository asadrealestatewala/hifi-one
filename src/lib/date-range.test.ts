import { describe, expect, it } from "vitest";
import { parseRange, rangeFilter, rangeLabel, rangePresets } from "./date-range";

describe("date ranges from the address", () => {
  it("keeps valid days and builds an inclusive filter", () => {
    const r = parseRange("2026-10-01", "2026-10-31");
    expect(r).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(rangeFilter(r)).toEqual({ gte: new Date("2026-10-01T00:00:00.000Z"), lte: new Date("2026-10-31T23:59:59.999Z") });
    expect(rangeLabel(r)).toBe("2026-10-01 to 2026-10-31");
  });
  it("ignores junk and reversed ranges", () => {
    expect(parseRange("yesterday", "2026-13-45")).toEqual({ from: undefined, to: undefined });
    expect(parseRange("2026-10-31", "2026-10-01")).toEqual({});
    expect(rangeFilter({})).toBeUndefined();
  });
  it("allows an open end", () => {
    expect(rangeFilter(parseRange("2026-10-01", undefined))).toEqual({ gte: new Date("2026-10-01T00:00:00.000Z") });
    expect(rangeLabel({ to: "2026-10-05" })).toBe("until 2026-10-05");
  });
});

describe("rangePresets", () => {
  it("gives whole-day ranges around the given day", () => {
    const p = Object.fromEntries(rangePresets(new Date("2026-11-09T11:00:00Z")).map((x) => [x.key, [x.from, x.to]]));
    expect(p.today).toEqual(["2026-11-09", "2026-11-09"]);
    expect(p.yesterday).toEqual(["2026-11-08", "2026-11-08"]);
    expect(p["7d"]).toEqual(["2026-11-03", "2026-11-09"]);
    expect(p.month).toEqual(["2026-11-01", "2026-11-09"]);
    expect(p.lastmonth).toEqual(["2026-10-01", "2026-10-31"]);
  });
  it("handles January", () => {
    const p = Object.fromEntries(rangePresets(new Date("2027-01-05T00:00:00Z")).map((x) => [x.key, [x.from, x.to]]));
    expect(p.lastmonth).toEqual(["2026-12-01", "2026-12-31"]);
  });
});
