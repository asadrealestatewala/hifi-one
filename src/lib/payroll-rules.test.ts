import { describe, expect, it } from "vitest";
import { calculatePay, periodBounds, unpaidDaysInPeriod } from "./payroll-rules";

describe("periodBounds", () => {
  it("handles month lengths and leap years", () => {
    expect(periodBounds("2026-10")).toEqual({ start: "2026-10-01", end: "2026-10-31" });
    expect(periodBounds("2028-02").end).toBe("2028-02-29");
    expect(() => periodBounds("2026-13")).toThrow();
  });
});

describe("unpaidDaysInPeriod", () => {
  it("counts only the working days inside the period", () => {
    // 2026-10: leave 28 Sep (Mon) to 2 Oct (Fri): only 1, 2 Oct count
    expect(unpaidDaysInPeriod("2026-10", [{ startDate: "2026-09-28", endDate: "2026-10-02" }])).toBe(2);
    expect(unpaidDaysInPeriod("2026-10", [{ startDate: "2026-11-02", endDate: "2026-11-06" }])).toBe(0);
  });
});

describe("calculatePay", () => {
  // October 2026 has 22 working days (Mon to Fri)
  it("pays full salary with no unpaid leave and withholds tax", () => {
    const r = calculatePay({ period: "2026-10", basic: "100000", allowance: "20000", taxPercent: "5", unpaidLeaves: [] });
    expect(r.workingDays).toBe(22);
    expect(r.gross.toString()).toBe("120000");
    expect(r.tax.toString()).toBe("6000");
    expect(r.net.toString()).toBe("114000");
  });
  it("deducts unpaid leave pro rata on basic only", () => {
    const r = calculatePay({ period: "2026-10", basic: "22000", allowance: "0", taxPercent: "0", unpaidLeaves: [{ startDate: "2026-10-05", endDate: "2026-10-06" }] });
    expect(r.unpaidDays).toBe(2);
    expect(r.unpaidDeduction.toString()).toBe("2000"); // 22000 / 22 * 2
    expect(r.net.toString()).toBe("20000");
  });
  it("includes bonus before tax and rounds half up to 2 places", () => {
    const r = calculatePay({ period: "2026-10", basic: "1000.01", allowance: "0", bonus: "100", taxPercent: "7.5", unpaidLeaves: [] });
    expect(r.gross.toString()).toBe("1100.01");
    expect(r.tax.toString()).toBe("82.5"); // 82.50075 -> 82.50
    expect(r.net.toString()).toBe("1017.51");
  });
  it("never goes negative when all days are unpaid", () => {
    const r = calculatePay({ period: "2026-10", basic: "5000", allowance: "0", taxPercent: "10", unpaidLeaves: [{ startDate: "2026-10-01", endDate: "2026-10-31" }] });
    expect(r.net.toString()).toBe("0");
    expect(r.unpaidDays).toBe(22);
  });
});
