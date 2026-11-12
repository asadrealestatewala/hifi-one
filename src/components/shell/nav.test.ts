import { describe, expect, it } from "vitest";
import { NAV, visibleNav } from "./nav";
import { SCREEN_GROUPS, SETTINGS_SECTIONS, groupTabs, settingsSections } from "./screen-groups";

const perms = (...keys: string[]) => new Set(keys);

describe("screen groups", () => {
  it("every group a menu entry names exists, and its fallback href is one of its tabs", () => {
    for (const g of NAV) {
      for (const i of g.items) {
        if (!i.group) continue;
        const group = SCREEN_GROUPS.find((x) => x.id === i.group);
        expect(group, `${i.label} names a group that does not exist`).toBeTruthy();
        // a group with a hub (Settings) sends the menu entry to that landing screen instead of a tab
        expect(group!.hub ? [group!.hub] : group!.tabs.map((t) => t.href)).toContain(i.href);
      }
    }
  });

  it("no screen appears twice, in two groups or as a group and a plain entry", () => {
    const hrefs = [...SCREEN_GROUPS.flatMap((g) => g.tabs.map((t) => t.href)), ...NAV.flatMap((g) => g.items.filter((i) => !i.group).map((i) => i.href))];
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("shows only the tabs a person may open", () => {
    expect(groupTabs("hr-activity", perms("attendance.view_all")).map((t) => t.label)).toEqual(["Attendance", "End of day", "Scorecards", "Site visits"]);
    expect(groupTabs("hr-activity", perms("monitoring.view_team")).map((t) => t.label)).toEqual(["Time tracking"]);
  });
});

describe("visibleNav", () => {
  it("shows one entry for a group and points it at the first tab the person may open", () => {
    const people = visibleNav(perms("monitoring.view_team")).find((g) => g.id === "people");
    expect(people!.items).toEqual([{ href: "/hr/monitoring", label: "Staff activity" }]);
  });

  it("drops the entry when the person may open no tab in it", () => {
    const people = visibleNav(perms("hr.view")).find((g) => g.id === "people");
    expect(people!.items.map((i) => i.label)).toEqual(["Staff directory", "Hiring"]);
  });

  it("drops the whole group when nothing in it is allowed", () => {
    expect(visibleNav(perms()).find((g) => g.id === "people")).toBeUndefined();
  });

  it("still filters plain entries by their own permission", () => {
    const people = visibleNav(perms("payroll.view"))!.find((g) => g.id === "people");
    expect(people!.items).toEqual([{ href: "/payroll", label: "Payroll" }]);
  });

  it("People & HR is five entries at most, however many permissions a person holds", () => {
    const keys = [...NAV.flatMap((g) => g.items.map((i) => i.permission)), ...SCREEN_GROUPS.flatMap((g) => g.tabs.map((t) => t.permission))];
    const all = new Set<string>(keys.filter((p) => p !== null));
    const people = visibleNav(all).find((g) => g.id === "people");
    expect(people!.items.map((i) => i.label)).toEqual(["Staff directory", "Staff activity", "Requests & notices", "Hiring", "Payroll"]);
  });
});

describe("Administration", () => {
  it("is three entries, and Settings opens the Settings page rather than the first setup screen", () => {
    const all = new Set<string>([...NAV.flatMap((g) => g.items.map((i) => i.permission)), ...SCREEN_GROUPS.flatMap((g) => g.tabs.map((t) => t.permission))].filter((p) => p !== null));
    const admin = visibleNav(all).find((g) => g.id === "admin");
    expect(admin!.items).toEqual([
      { href: "/settings", label: "Settings" },
      { href: "/users", label: "Users & roles" },
      { href: "/audit-logs", label: "Audit & security" },
    ]);
  });

  it("shows Settings to somebody who may open only one setup screen", () => {
    const admin = visibleNav(perms("jobs.run")).find((g) => g.id === "admin");
    expect(admin!.items).toEqual([{ href: "/settings", label: "Settings" }]);
  });

  it("every settings screen sits in exactly one section of the Settings page", () => {
    const inSections = SETTINGS_SECTIONS.flatMap((s) => s.hrefs);
    expect(new Set(inSections).size).toBe(inSections.length);
    expect([...inSections].sort()).toEqual(SCREEN_GROUPS.find((g) => g.id === "admin-settings")!.tabs.map((t) => t.href).sort());
  });

  it("the Settings page lists only the sections a person may open", () => {
    expect(settingsSections(perms("jobs.run"))).toEqual([{ title: "Monitoring & jobs", what: "What is tracked, and the work that runs on its own.", icon: "clock", tabs: [{ href: "/settings/jobs", label: "Scheduled jobs", permission: "jobs.run" }] }]);
    expect(settingsSections(perms())).toEqual([]);
  });
});

describe("CRM & sales", () => {
  it("is nine entries, with Field visits on its own", () => {
    const all = new Set<string>([...NAV.flatMap((g) => g.items.map((i) => i.permission)), ...SCREEN_GROUPS.flatMap((g) => g.tabs.map((t) => t.permission))].filter((p) => p !== null));
    const crm = visibleNav(all).find((g) => g.id === "crm");
    expect(crm!.items.map((i) => i.label)).toEqual(["Contacts", "Leads", "Opportunities", "Prospector", "Field visits", "Campaigns", "Clout Leader", "Quotations", "Sales reports"]);
  });

  it("a field agent sees Field visits and their own prospects, not the team screens", () => {
    const crm = visibleNav(perms("field.capture", "crm.edit")).find((g) => g.id === "crm");
    expect(crm!.items).toEqual([{ href: "/leads/prospector/mine", label: "Prospector" }, { href: "/field", label: "Field visits" }]);
  });
})
