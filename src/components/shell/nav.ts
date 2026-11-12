import type { PermissionKey } from "@/lib/permissions";
import { groupTabs, screenGroup } from "./screen-groups";

// permission null = every signed-in employee (own profile, own tasks, help, own security)
// group = a screen group from screen-groups.ts: one entry standing for several tabbed screens. It shows when the
// person can open at least one tab and points at the first one they can open, so `href` here is only the fallback.
export type NavItem = { href: string; label: string; permission: PermissionKey | null; group?: string };
export type NavGroup = { id: string; title: string; icon: string; items: NavItem[] };

// Menu items render only when the user holds the permission. Pages and actions re-check on the server,
// so hiding a link is never the only protection.
export const NAV: NavGroup[] = [
  { id: "overview", title: "Overview", icon: "home", items: [
    { href: "/dashboard", label: "Dashboard", permission: "dashboard.view" },
    { href: "/search", label: "Search", permission: "dashboard.view" },
    { href: "/approvals", label: "Approvals", permission: null },
    { href: "/mail", label: "Mailbox", permission: null },
    { href: "/assistant", label: "Assistant", permission: "assistant.use" },
  ] },
  // Leads, Prospector and Sales reports are tab groups (screen-groups.ts); Field visits stays on its own because
  // for a field agent it is the only screen they open, and it works offline.
  { id: "crm", title: "CRM & sales", icon: "target", items: [
    { href: "/contacts", label: "Contacts", permission: "crm.view" },
    { href: "/leads", label: "Leads", permission: null, group: "crm-leads" },
    { href: "/pipeline", label: "Opportunities", permission: "crm.view" },
    { href: "/leads/prospector", label: "Prospector", permission: null, group: "crm-prospector" },
    { href: "/field", label: "Field visits", permission: "field.capture" },
    { href: "/campaigns", label: "Campaigns", permission: "campaigns.view" },
    { href: "/clout", label: "Clout Leader", permission: "clout.view" },
    { href: "/quotes", label: "Quotations", permission: "quotes.view" },
    { href: "/sales/activity", label: "Sales reports", permission: null, group: "crm-reports" },
  ] },
  { id: "clients", title: "Services & clients", icon: "layers", items: [
    { href: "/services", label: "Service catalog", permission: "catalog.view" },
    { href: "/clients", label: "Clients", permission: "clients.view" },
    { href: "/engagements", label: "Retainers", permission: "clients.view" },
    { href: "/contracts", label: "Contracts", permission: null, group: "client-contracts" },
    { href: "/support", label: "Support requests", permission: "support.view" },
    { href: "/finance/invoices", label: "Billing", permission: null, group: "client-billing" },
  ] },
  { id: "projects", title: "Project operations", icon: "briefcase", items: [
    { href: "/projects", label: "Projects", permission: "projects.view" },
    { href: "/content", label: "Content calendar", permission: "content.view" },
    { href: "/chat", label: "Team chat", permission: "chat.use" },
    { href: "/meetings", label: "Meetings", permission: "meetings.use" },
  ] },
  { id: "finance", title: "Finance & accounting", icon: "wallet", items: [
    { href: "/finance/ledger", label: "Books", permission: null, group: "fin-books" },
    { href: "/finance/reconciliation", label: "Bank reconciliation", permission: "bank.reconcile" },
    { href: "/finance/budgets", label: "Budgets", permission: "budget.view" },
    { href: "/finance/commissions", label: "Commissions", permission: "commissions.manage" },
    { href: "/finance/reports", label: "Financial reports", permission: "reports.view" },
    { href: "/assets", label: "Assets & investments", permission: null, group: "fin-assets" },
  ] },
  // Four entries, each a screen group with tabs (screen-groups.ts), plus payroll.
  { id: "people", title: "People & HR", icon: "users", items: [
    { href: "/hr/employees", label: "Staff directory", permission: null, group: "hr-records" },
    { href: "/hr/attendance", label: "Staff activity", permission: null, group: "hr-activity" },
    { href: "/hr/leave", label: "Requests & notices", permission: null, group: "hr-requests" },
    { href: "/hr/applications", label: "Hiring", permission: null, group: "hr-hiring" },
    { href: "/payroll", label: "Payroll", permission: "payroll.view" },
  ] },
  { id: "vendors", title: "Procurement & vendors", icon: "truck", items: [
    { href: "/vendors", label: "Vendors", permission: "vendors.view" },
    { href: "/procurement", label: "Orders & bills", permission: "vendors.view" },
  ] },
  // My space is deliberately six entries. Everything else a person owns lives on My day (/me), grouped there,
  // so the menu stays short without hiding anything.
  { id: "me", title: "My space", icon: "user", items: [
    { href: "/me", label: "My day", permission: null },
    { href: "/me/attendance", label: "My attendance", permission: "self.attendance" },
    { href: "/me/tasks", label: "My tasks", permission: null },
    { href: "/me/team", label: "My team", permission: "leave.approve" },
    { href: "/me/leave", label: "My leave", permission: "self.leave" },
    { href: "/me/payslips", label: "My payslips", permission: "self.payslip" },
    { href: "/me/profile", label: "My profile", permission: null },
  ] },
  // Three entries: the Settings page (fifteen setup screens, grouped there), and two tab groups.
  { id: "admin", title: "Administration", icon: "settings", items: [
    { href: "/settings", label: "Settings", permission: null, group: "admin-settings" },
    { href: "/users", label: "Users & roles", permission: null, group: "admin-people" },
    { href: "/audit-logs", label: "Audit & security", permission: null, group: "admin-audit" },
  ] },
];

export type QuickCreate = { href: string; label: string; permission: PermissionKey; icon: string };
export const QUICK_CREATE: QuickCreate[] = [
  { href: "/leads", label: "New lead", permission: "crm.edit", icon: "target" },
  { href: "/clients", label: "New client", permission: "clients.edit", icon: "building" },
  { href: "/quotes", label: "New quotation", permission: "quotes.manage", icon: "file" },
  { href: "/finance/invoices", label: "New invoice", permission: "finance.post", icon: "receipt" },
  { href: "/projects", label: "New project", permission: "projects.manage", icon: "briefcase" },
  { href: "/meetings", label: "New meeting", permission: "meetings.use", icon: "video" },
  { href: "/expenses", label: "New expense voucher", permission: "self.expense", icon: "wallet" },
  { href: "/me/leave", label: "Request leave", permission: "self.leave", icon: "calendar" },
];

// The menu a person may see, before their own arrangement is applied. Used by the layout and by the action that saves the arrangement.
export function visibleNav(permissions: ReadonlySet<string>) {
  return NAV.map((g) => ({
    id: g.id, title: g.title, icon: g.icon,
    items: g.items.flatMap((i) => {
      if (i.group) {
        const tabs = groupTabs(i.group, permissions);
        if (tabs.length === 0) return [];
        return [{ href: screenGroup(i.group).hub ?? tabs[0].href, label: i.label }];
      }
      return i.permission === null || permissions.has(i.permission) ? [{ href: i.href, label: i.label }] : [];
    }),
  })).filter((g) => g.items.length > 0);
}
