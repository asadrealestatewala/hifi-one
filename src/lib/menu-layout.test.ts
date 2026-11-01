import { describe, expect, it } from "vitest";
import { applyMenu, moveShown, moveTo, sanitizeMenu, type MenuGroup } from "./menu-layout";

const g = (id: string, ...hrefs: string[]): MenuGroup => ({ id, title: id, icon: "home", items: hrefs.map((h) => ({ href: h, label: h })) });
const groups = [g("overview", "/dashboard", "/search"), g("crm", "/contacts", "/leads"), g("finance", "/ledger")];

describe("menu arrangement", () => {
  it("defaults to the given order with nothing hidden", () => {
    expect(sanitizeMenu(undefined, groups)).toEqual({ order: ["overview", "crm", "finance"], hidden: [], colors: {}, theme: "default" });
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
    expect(p).toEqual({ order: ["crm", "overview", "finance"], hidden: ["finance"], colors: {}, theme: "default" });
  });

  it("never produces an empty menu", () => {
    const all = sanitizeMenu({ hidden: ["overview", "crm", "finance"] }, groups);
    expect(applyMenu(groups, all)).toEqual(groups);
  });

  it("keeps icon colours only for visible groups and only as #rrggbb, and only known themes", () => {
    const p = sanitizeMenu({ colors: { crm: "#AABBCC", finance: "red", payroll: "#123456", overview: "#12345", __proto__: "#000000" }, theme: "ocean" }, groups);
    expect(p.colors).toEqual({ crm: "#aabbcc" });
    expect(p.theme).toBe("ocean");
    expect(sanitizeMenu({ theme: "hotpink" }, groups).theme).toBe("default");
    expect(sanitizeMenu({ colors: ["#000000"] }, groups).colors).toEqual({});
  });

  it("moves a shown group onto another one's place, leaving hidden groups in their slots", () => {
    // finance is hidden, so the sidebar shows overview, crm, me
    const order = ["overview", "finance", "crm", "me"];
    expect(moveShown(order, ["overview", "crm", "me"], "me", "crm")).toEqual(["overview", "finance", "me", "crm"]);
    expect(moveShown(order, ["overview", "crm", "me"], "me", "overview")).toEqual(["me", "finance", "overview", "crm"]);
    expect(moveShown(order, ["overview", "crm", "me"], "overview", "me")).toEqual(["crm", "finance", "me", "overview"]);
    expect(moveShown(order, ["overview", "crm"], "secret", "crm")).toEqual(order);
  });

  it("moves an id to a given index", () => {
    expect(moveTo(["a", "b", "c", "d"], "d", 1)).toEqual(["a", "d", "b", "c"]);
    expect(moveTo(["a", "b", "c"], "a", 9)).toEqual(["b", "c", "a"]);
    expect(moveTo(["a", "b"], "x", 0)).toEqual(["a", "b"]);
  });
});
