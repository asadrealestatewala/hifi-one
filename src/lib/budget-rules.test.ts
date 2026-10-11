import { describe, expect, it } from "vitest";
import { canTransfer, effectiveBudget, utilization, wouldExceed } from "./budget-rules";

describe("budget rules", () => {
  it("transfers adjust the effective budget without touching the original", () => {
    expect(effectiveBudget("100000", ["20000"], ["5000"]).toString()).toBe("115000");
  });
  it("reports utilization level at 75, 90 and 100 percent", () => {
    expect(utilization("1000", "0", "500").level).toBe(0);
    expect(utilization("1000", "100", "650").level).toBe(75);
    expect(utilization("1000", "0", "900").level).toBe(90);
    const full = utilization("1000", "500", "500");
    expect(full.level).toBe(100);
    expect(full.over).toBe(false);
    expect(utilization("1000", "0", "1200").over).toBe(true);
  });
  it("committed and incurred both count against the limit", () => {
    expect(wouldExceed("1000", "400", "500", "100")).toBe(false);
    expect(wouldExceed("1000", "400", "500", "100.01")).toBe(true);
  });
  it("only unspent money can be transferred out", () => {
    expect(canTransfer("1000", "200", "300", "500")).toBe(true);
    expect(canTransfer("1000", "200", "300", "500.01")).toBe(false);
    expect(canTransfer("1000", "0", "0", "0")).toBe(false);
  });
  it("a zero budget with spend is reported as over", () => {
    expect(utilization("0", "0", "10").over).toBe(true);
  });
});
