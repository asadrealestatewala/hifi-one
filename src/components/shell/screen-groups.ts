import type { PermissionKey } from "@/lib/permissions";

// A screen group is several screens that answer one question, shown as one menu entry with tabs along the top.
// Each tab keeps its own route, its own guard and its own writer: the tabs only change what you are looking at.
// The menu entry appears when a person can see at least one tab, and points at the first tab they can see.
// `hub` is for a group too large for a tab row: the menu entry goes to that landing screen instead of the first tab,
// and the screens carry a link back to it rather than tabs.
export type GroupTab = { href: string; label: string; permission: PermissionKey | null };
export type ScreenGroup = { id: string; label: string; tabs: GroupTab[]; hub?: string };

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
  { id: "partner-stack", label: "Partner Stack", tabs: [
    { href: "/partner-stack", label: "Applications", permission: "partners.manage" },
    { href: "/partner-stack/partners", label: "Partners", permission: "partners.manage" },
    { href: "/partner-stack/certificates", label: "Certificates", permission: "partners.manage" },
    { href: "/partner-stack/inquiries", label: "Inquiries", permission: "partners.manage" },
    { href: "/partner-stack/settings", label: "Settings", permission: "partners.settings" },
  ] },
  { id: "client-contracts", label: "Contracts", tabs: [
    { href: "/contracts", label: "Contracts", permission: "contracts.view" },
    { href: "/agreements", label: "Agreements", permission: "contracts.view" },
  ] },
  { id: "client-billing", label: "Billing", tabs: [
    { href: "/finance/invoices", label: "Invoices", permission: "finance.view" },
    { href: "/finance/payments", label: "Payments & receipts", permission: "finance.view" },
    { href: "/finance/subscriptions", label: "Subscriptions", permission: "finance.view" },
  ] },
  { id: "fin-books", label: "Books", tabs: [
    { href: "/finance/ledger", label: "General ledger", permission: "finance.view" },
    { href: "/finance/accounts", label: "Chart of accounts", permission: "finance.view" },
    { href: "/finance/journals", label: "Manual journals", permission: "finance.view" },
    { href: "/finance/close", label: "Close periods", permission: "finance.view" },
    { href: "/finance/year-end", label: "Year-end", permission: "finance.view" },
  ] },
  { id: "fin-assets", label: "Assets & investments", tabs: [
    { href: "/assets", label: "Fixed assets", permission: "assets.view" },
    { href: "/investments", label: "Investments", permission: "investments.view" },
  ] },
  { id: "crm-leads", label: "Leads", tabs: [
    { href: "/leads", label: "All leads", permission: "crm.view" },
    { href: "/leads/approvals", label: "Pending approvals", permission: "crm.convert" },
    { href: "/leads/lists", label: "Smart lists", permission: "crm.view" },
    { href: "/leads/worklists", label: "Worklists", permission: "crm.view" },
    { href: "/leads/follow-ups", label: "Follow-up automation", permission: "followups.manage" },
    { href: "/settings/lead-sources", label: "Website forms", permission: "leadsources.manage" },
  ] },
  { id: "crm-prospector", label: "Prospector", tabs: [
    { href: "/leads/prospector", label: "All prospects", permission: "crm.view" },
    { href: "/leads/prospector/mine", label: "My prospects", permission: "crm.edit" },
    { href: "/leads/prospector/field-team", label: "Field sales team", permission: "field.review" },
    { href: "/leads/prospector/demos", label: "Demo queue", permission: "prospector.schedule_demo" },
  ] },
  { id: "crm-reports", label: "Sales reports", tabs: [
    { href: "/sales/activity", label: "Activity", permission: "crm.view" },
    { href: "/sales/leads-report", label: "Leads report", permission: "crm.view" },
  ] },
  { id: "admin-people", label: "Users & roles", tabs: [
    { href: "/users", label: "Users", permission: "users.view" },
    { href: "/roles", label: "Roles & permissions", permission: "roles.manage" },
  ] },
  { id: "admin-audit", label: "Audit & security", tabs: [
    { href: "/audit-logs", label: "Audit log", permission: "audit.view" },
    { href: "/settings/security", label: "Security checklist", permission: "audit.view" },
  ] },
  // Fifteen setup screens: too many for a tab row, so the menu entry opens the Settings page and each screen
  // carries a link back to it. SETTINGS_SECTIONS below is how that page is laid out.
  { id: "admin-settings", label: "Settings", hub: "/settings", tabs: [
    { href: "/settings/company", label: "Company details", permission: "settings.company.view" },
    { href: "/settings/calendar", label: "Working calendar", permission: "settings.company.view" },
    { href: "/settings/organization", label: "Offices & departments", permission: "users.view" },
    { href: "/settings/documents", label: "Document templates", permission: "settings.company.view" },
    { href: "/settings/bank-accounts", label: "Bank accounts", permission: "bank.view" },
    { href: "/settings/tax-rates", label: "Tax rates", permission: "settings.company.view" },
    { href: "/settings/exchange-rates", label: "Exchange rates", permission: "reports.view" },
    { href: "/settings/email", label: "Outgoing email", permission: "settings.company.view" },
    { href: "/settings/mailboxes", label: "Mailboxes", permission: "mail.manage" },
    { href: "/settings/email-templates", label: "Email templates", permission: "email_templates.manage" },
    { href: "/settings/integrations", label: "Integrations", permission: "integrations.manage" },
    { href: "/settings/duplicates", label: "Duplicate leads", permission: "crm.duplicates" },
    { href: "/settings/quest", label: "Sales quest", permission: "crm.quest_settings" },
    { href: "/settings/monitoring", label: "Monitoring policy", permission: "monitoring.configure" },
    { href: "/settings/jobs", label: "Scheduled jobs", permission: "jobs.run" },
  ] },
];

// How the Settings page groups those screens. Every tab of the admin-settings group appears in exactly one section.
export type SettingsSection = { title: string; what: string; icon: string; hrefs: string[] };
export const SETTINGS_SECTIONS: SettingsSection[] = [
  { title: "Company", what: "Who you are, when you work, and how your paperwork reads.", icon: "building",
    hrefs: ["/settings/company", "/settings/calendar", "/settings/organization", "/settings/documents"] },
  { title: "Money setup", what: "The accounts, taxes and currencies the figures are built on.", icon: "wallet",
    hrefs: ["/settings/bank-accounts", "/settings/tax-rates", "/settings/exchange-rates"] },
  { title: "Email", what: "What the system sends, from where, and in what words.", icon: "mail",
    hrefs: ["/settings/email", "/settings/mailboxes", "/settings/email-templates"] },
  { title: "Sales rules", what: "Outside services, duplicate leads and the sales quest.", icon: "target",
    hrefs: ["/settings/integrations", "/settings/duplicates", "/settings/quest"] },
  { title: "Monitoring & jobs", what: "What is tracked, and the work that runs on its own.", icon: "clock",
    hrefs: ["/settings/monitoring", "/settings/jobs"] },
];

export function settingsSections(permissions: ReadonlySet<string>): { title: string; what: string; icon: string; tabs: GroupTab[] }[] {
  const tabs = screenGroup("admin-settings").tabs;
  return SETTINGS_SECTIONS.map((s) => ({
    title: s.title, what: s.what, icon: s.icon,
    tabs: s.hrefs.map((h) => tabs.find((t) => t.href === h)!).filter((t) => t.permission === null || permissions.has(t.permission)),
  })).filter((s) => s.tabs.length > 0);
}

export function screenGroup(id: string): ScreenGroup {
  const g = SCREEN_GROUPS.find((x) => x.id === id);
  if (!g) throw new Error(`Unknown screen group: ${id}`);
  return g;
}

// The tabs this person may open, in order. Empty means the whole group is out of reach, so its menu entry is dropped.
export function groupTabs(id: string, permissions: ReadonlySet<string>): GroupTab[] {
  return screenGroup(id).tabs.filter((t) => t.permission === null || permissions.has(t.permission));
}
