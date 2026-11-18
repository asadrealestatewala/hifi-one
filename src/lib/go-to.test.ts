import { describe, expect, it } from "vitest";
import { destinations, GO_TO_WORDS, matchDestinations } from "./go-to";
import { NAV } from "../components/shell/nav";
import { SCREEN_GROUPS } from "../components/shell/screen-groups";
import { PERMISSIONS } from "./permissions";

const ALL = new Set<string>(Object.keys(PERMISSIONS));
const first = (perms: ReadonlySet<string>, q: string) => matchDestinations(destinations(perms), q)[0];

describe("Go to: screens and tabs a person may open", () => {
  it("lists every tab of every screen group for someone who may open them all", () => {
    const hrefs = new Set(destinations(ALL).map((d) => d.href));
    for (const g of SCREEN_GROUPS) for (const t of g.tabs) expect(hrefs.has(t.href), t.href).toBe(true);
    for (const g of NAV) for (const i of g.items) if (!i.group) expect(hrefs.has(i.href), i.href).toBe(true);
  });

  it("shows the path to a tab", () => {
    expect(first(ALL, "attendance")?.href).toBe("/hr/attendance");
    expect(first(ALL, "attendance")?.trail).toEqual(["People & HR", "Staff activity"]);
    expect(first(ALL, "working calendar")).toMatchObject({ href: "/settings/calendar", trail: ["Administration", "Settings"] });
  });

  it("finds a menu entry that stands for several tabs by its own name", () => {
    expect(first(ALL, "staff activity")).toMatchObject({ href: "/hr/attendance", label: "Staff activity", trail: ["People & HR"] });
    expect(first(ALL, "sales reports")).toMatchObject({ href: "/sales/activity", label: "Sales reports" });
    expect(first(ALL, "settings")).toMatchObject({ href: "/settings", label: "Settings" });
  });

  it("finds the Projects screen by its menu name", () => {
    expect(first(ALL, "projects")?.href).toBe("/projects");
    expect(first(ALL, "project")?.href).toBe("/projects");
  });

  it("finds a screen by an everyday word", () => {
    expect(first(ALL, "holidays")?.href).toBe("/settings/calendar");
    expect(first(ALL, "salary")?.href).toBe("/payroll");
    expect(first(ALL, "logo")?.href).toBe("/settings/company");
  });

  it("does not repeat a tab named like its menu entry", () => {
    expect(destinations(ALL).find((d) => d.href === "/contracts")?.trail).toEqual(["Services & clients"]);
  });

  it("never offers a screen the person may not open", () => {
    const staff = new Set<string>(["dashboard.view", "self.attendance", "self.leave"]);
    const list = destinations(staff);
    expect(list.some((d) => d.href === "/payroll")).toBe(false);
    expect(list.some((d) => d.href.startsWith("/settings"))).toBe(false);
    expect(list.some((d) => d.href === "/hr/attendance")).toBe(false);
    expect(first(staff, "salary")).toBeUndefined();
    expect(first(staff, "holidays")?.href).toBe("/me/leave");
    // a group shows only the tabs the person holds the permission for
    const hrLite = new Set<string>(["hr.view"]);
    const hrefs = destinations(hrLite).map((d) => d.href);
    expect(hrefs).toContain("/hr/employees");
    expect(hrefs).not.toContain("/hr/documents");
  });

  it("returns nothing for an empty or unmatched query", () => {
    expect(matchDestinations(destinations(ALL), "  ")).toEqual([]);
    expect(matchDestinations(destinations(ALL), "zzqx")).toEqual([]);
  });

  it("keeps everyday words only for screens that exist", () => {
    const hrefs = new Set(destinations(ALL).map((d) => d.href));
    for (const h of Object.keys(GO_TO_WORDS)) expect(hrefs.has(h), h).toBe(true);
  });
});
