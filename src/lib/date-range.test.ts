import { describe, expect, it } from "vitest";
import { parseRange, rangeFilter, rangeLabel } from "./date-range";

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
