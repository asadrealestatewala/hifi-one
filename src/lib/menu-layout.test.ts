import { describe, expect, it } from "vitest";
import { applyMenu, sanitizeMenu, type MenuGroup } from "./menu-layout";

const g = (id: string, ...hrefs: string[]): MenuGroup => ({ id, title: id, icon: "home", items: hrefs.map((h) => ({ href: h, label: h })) });
const groups = [g("overview", "/dashboard", "/search"), g("crm", "/contacts", "/leads"), g("finance", "/ledger")];

describe("menu arrangement", () => {
  it("defaults to the given order with nothing hidden", () => {
    expect(sanitizeMenu(undefined, groups)).toEqual({ order: ["overview", "crm", "finance"], hidden: [] });
    expect(applyMenu(groups, sanitizeMenu(undefined, groups)).map((x) => x.id)).toEqual(["overview", "crm", "finance"]);
  });

  it("reorders groups and puts groups added later at the end", () => {
    const p = sanitizeMenu({ order: ["finance", "overview"] }, groups);
    expect(p.order).toEqual(["finance", "overview", "crm"]);
    expect(applyMenu(groups, p).map((x) => x.id)).toEqual(["finance", "overview", "crm"]);
  });

  it("hides whole groups and single items, and drops a group left with no items", () => {
    const a = applyMenu(groups, sanitizeMenu({ hidden: ["crm", "/search"] }, groups));
    expect(a.map((x) => x.id)).toEqual(["overview", "finance"]);
    expect(a[0].items.map((i) => i.href)).toEqual(["/dashboard"]);
    const b = applyMenu(groups, sanitizeMenu({ hidden: ["/ledger"] }, groups));
    expect(b.map((x) => x.id)).toEqual(["overview", "crm"]);
  });

  it("ignores things the person cannot see, wrong types and repeats", () => {
    const p = sanitizeMenu({ order: ["secret", "crm", "crm", 5], hidden: ["/payroll", "payroll", "finance", "finance", null] }, groups);
    expect(p).toEqual({ order: ["crm", "overview", "finance"], hidden: ["finance"] });
  });

  it("never produces an empty menu", () => {
    const all = sanitizeMenu({ hidden: ["overview", "crm", "finance"] }, groups);
    expect(applyMenu(groups, all)).toEqual(groups);
  });
});
