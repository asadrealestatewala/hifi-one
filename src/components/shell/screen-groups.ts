import type { PermissionKey } from "@/lib/permissions";

// A screen group is several screens that answer one question, shown as one menu entry with tabs along the top.
// Each tab keeps its own route, its own guard and its own writer: the tabs only change what you are looking at.
// The menu entry appears when a person can see at least one tab, and points at the first tab they can see.
export type GroupTab = { href: string; label: string; permission: PermissionKey | null };
export type ScreenGroup = { id: string; label: string; tabs: GroupTab[] };

export const SCREEN_GROUPS: ScreenGroup[] = [
  { id: "hr-records", label: "Staff directory", tabs: [
    { href: "/hr/employees", label: "Directory", permission: "hr.view" },
    { href: "/hr/documents", label: "Documents", permission: "hr.view_sensitive" },
  ] },
  { id: "hr-activity", label: "Staff activity", tabs: [
    { href: "/hr/attendance", label: "Attendance", permission: "attendance.view_all" },
    { href: "/hr/reports", label: "Daily reports", permission: "leave.approve" },
    { href: "/hr/reports/eod", label: "End of day", permission: "attendance.view_all" },
    { href: "/hr/scorecards", label: "Scorecards", permission: "attendance.view_all" },
    { href: "/hr/visits", label: "Site visits", permission: "attendance.view_all" },
    { href: "/hr/monitoring", label: "Time tracking", permission: "monitoring.view_team" },
  ] },
  { id: "hr-requests", label: "Requests & notices", tabs: [
    { href: "/hr/leave", label: "Leave", permission: "leave.approve" },
    { href: "/hr/requests", label: "Other requests", permission: "hr.manage" },
    { href: "/hr/circulars", label: "Circulars", permission: "circulars.send" },
  ] },
  { id: "hr-hiring", label: "Hiring", tabs: [
    { href: "/hr/applications", label: "Applications", permission: "hr.view" },
    { href: "/hr/onboarding", label: "Onboarding", permission: "hr.view" },
  ] },
];

export function screenGroup(id: string): ScreenGroup {
  const g = SCREEN_GROUPS.find((x) => x.id === id);
  if (!g) throw new Error(`Unknown screen group: ${id}`);
  return g;
}

// The tabs this person may open, in order. Empty means the whole group is out of reach, so its menu entry is dropped.
export function groupTabs(id: string, permissions: ReadonlySet<string>): GroupTab[] {
  return screenGroup(id).tabs.filter((t) => t.permission === null || permissions.has(t.permission));
}
