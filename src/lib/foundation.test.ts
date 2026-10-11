import { describe, expect, it } from "vitest";
import { maskAccount } from "./mask";
import { ALL_PERMISSIONS, ROLE_DEFS } from "./permissions";

describe("maskAccount", () => {
  it("shows only the last four characters", () => {
    expect(maskAccount("1234 5678 9012")).toBe("••••9012");
  });
  it("hides very short values entirely", () => {
    expect(maskAccount("123")).toBe("••••");
  });
  it("returns empty for missing values", () => {
    expect(maskAccount(null)).toBe("");
  });
});

describe("role definitions", () => {
  it("only reference permissions that exist", () => {
    for (const r of ROLE_DEFS) {
      if (r.permissions === "ALL") continue;
      for (const p of r.permissions) expect(ALL_PERMISSIONS).toContain(p);
    }
  });
  it("gives only Super Admin everything, and externals nothing", () => {
    const all = ROLE_DEFS.filter((r) => r.permissions === "ALL").map((r) => r.key);
    expect(all).toEqual(["SUPER_ADMIN"]);
    for (const k of ["CLIENT", "VENDOR", "BUSINESS_PARTNER", "INVESTOR"]) {
      expect(ROLE_DEFS.find((r) => r.key === k)?.permissions).toEqual([]);
    }
  });
  it("lets only finance see full bank numbers besides Super Admin", () => {
    const withFull = ROLE_DEFS.filter((r) => r.permissions !== "ALL" && r.permissions.includes("bank.view_full"));
    expect(withFull.map((r) => r.key)).toEqual(["FINANCE_MANAGER"]);
  });
  it("keeps manager permissions when roles get extra permissions (no overwritten entries)", () => {
    const pm = ROLE_DEFS.find((r) => r.key === "PROJECT_MANAGER")!.permissions as string[];
    expect(pm).toContain("leave.approve");
    expect(pm).toContain("budget.view");
    expect(pm).toContain("self.expense");
  });
  it("separates who can approve expenses from who can submit them", () => {
    const has = (k: string, p: string) => (ROLE_DEFS.find((r) => r.key === k)!.permissions as string[]).includes(p);
    expect(has("INTERN", "self.expense")).toBe(true);
    expect(has("INTERN", "expenses.approve")).toBe(false);
    expect(has("ACCOUNTANT", "expenses.approve")).toBe(false);
    expect(has("FINANCE_MANAGER", "expenses.approve")).toBe(true);
    expect(has("FINANCE_MANAGER", "budget.override")).toBe(false); // override sits with leadership
  });
});
