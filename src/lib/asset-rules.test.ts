import { describe, expect, it } from "vitest";
import { addMonths, monthlyAmount, netBookValue, periodsDue } from "./asset-rules";
import { dec } from "./ledger-math";

describe("addMonths", () => {
  it("rolls over years", () => {
    expect(addMonths("2026-11", 1)).toBe("2026-12");
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", 25)).toBe("2028-02");
  });
});

describe("monthlyAmount", () => {
  it("splits evenly when divisible", () => {
    expect(monthlyAmount("12000", "0", 12, 0).toString()).toBe("1000");
  });
  it("total always equals cost minus salvage, with the last month absorbing rounding", () => {
    const months = 7;
    let total = dec(0);
    for (let i = 0; i < months; i++) total = total.add(monthlyAmount("1000", "100", months, i));
    expect(total.toString()).toBe("900");
    expect(monthlyAmount("1000", "100", months, 0).toString()).toBe("128.57"); // 900 / 7
  });
  it("rejects bad inputs", () => {
    expect(() => monthlyAmount("100", "200", 12, 0)).toThrow();
    expect(() => monthlyAmount("100", "0", 0, 0)).toThrow();
  });
});

describe("periodsDue", () => {
  it("starts in the purchase month and skips what is already posted", () => {
    expect(periodsDue("2026-10-20", 36, "2026-12", [])).toEqual(["2026-10", "2026-11", "2026-12"]);
    expect(periodsDue("2026-10-20", 36, "2026-12", ["2026-10"])).toEqual(["2026-11", "2026-12"]);
  });
  it("never goes beyond the useful life", () => {
    expect(periodsDue("2026-10-01", 2, "2030-01", [])).toEqual(["2026-10", "2026-11"]);
  });
  it("nothing is due before the purchase month", () => {
    expect(periodsDue("2026-10-01", 12, "2026-09", [])).toEqual([]);
  });
});

describe("netBookValue", () => {
  it("is cost minus accumulated depreciation", () => {
    expect(netBookValue("1200", "300").toString()).toBe("900");
  });
});
