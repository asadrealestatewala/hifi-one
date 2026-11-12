import type { PermissionKey } from "@/lib/permissions";

// permission null = every signed-in employee (own profile, own tasks, help, own security)
export type NavItem = { href: string; label: string; permission: PermissionKey | null };
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
  { id: "crm", title: "CRM & sales", icon: "target", items: [
    { href: "/contacts", label: "Contacts", permission: "crm.view" },
    { href: "/leads", label: "Leads", permission: "crm.view" },
    { href: "/pipeline", label: "Opportunities", permission: "crm.view" },
    { href: "/leads/approvals", label: "Pending approvals", permission: "crm.convert" },
    { href: "/leads/lists", label: "Smart lists", permission: "crm.view" },
    { href: "/leads/prospector", label: "Prospector", permission: "crm.view" },
    { href: "/leads/prospector/mine", label: "My prospects", permission: "crm.edit" },
    { href: "/field", label: "Field visits", permission: "field.capture" },
    { href: "/leads/prospector/field-team", label: "Field sales team", permission: "field.review" },
    { href: "/leads/prospector/demos", label: "Demo queue", permission: "prospector.schedule_demo" },
    { href: "/leads/worklists", label: "Prospecting worklists", permission: "crm.view" },
    { href: "/settings/lead-sources", label: "Website lead forms", permission: "leadsources.manage" },
    { href: "/leads/follow-ups", label: "Follow-up automation", permission: "followups.manage" },
    { href: "/campaigns", label: "Campaigns", permission: "campaigns.view" },
    { href: "/clout", label: "Clout Leader", permission: "clout.view" },
    { href: "/sales/activity", label: "Sales activity", permission: "crm.view" },
    { href: "/sales/leads-report", label: "Leads report", permission: "crm.view" },
    { href: "/quotes", label: "Quotations", permission: "quotes.view" },
  ] },
  { id: "clients", title: "Services & clients", icon: "layers", items: [
    { href: "/services", label: "Service catalog", permission: "catalog.view" },
    { href: "/clients", label: "Clients", permission: "clients.view" },
    { href: "/engagements", label: "Retainers", permission: "clients.view" },
    { href: "/contracts", label: "Contracts", permission: "contracts.view" },
    { href: "/agreements", label: "Agreements", permission: "contracts.view" },
    { href: "/support", label: "Support requests", permission: "support.view" },
    { href: "/finance/subscriptions", label: "Subscriptions", permission: "finance.view" },
    { href: "/finance/invoices", label: "Invoices", permission: "finance.view" },
    { href: "/finance/payments", label: "Payments & receipts", permission: "finance.view" },
  ] },
  { id: "projects", title: "Project operations", icon: "briefcase", items: [
    { href: "/projects", label: "Projects", permission: "projects.view" },
    { href: "/content", label: "Content calendar", permission: "content.view" },
    { href: "/chat", label: "Team chat", permission: "chat.use" },
    { href: "/meetings", label: "Meetings", permission: "meetings.use" },
  ] },
  { id: "finance", title: "Finance & accounting", icon: "wallet", items: [
    { href: "/finance/ledger", label: "General ledger", permission: "finance.view" },
    { href: "/finance/accounts", label: "Chart of accounts", permission: "finance.view" },
    { href: "/finance/journals", label: "Manual journals", permission: "finance.view" },
    { href: "/finance/reconciliation", label: "Bank reconciliation", permission: "bank.reconcile" },
    { href: "/finance/budgets", label: "Budgets", permission: "budget.view" },
    { href: "/finance/commissions", label: "Commissions", permission: "commissions.manage" },
    { href: "/finance/reports", label: "Financial reports", permission: "reports.view" },
    { href: "/finance/close", label: "Close periods", permission: "finance.view" },
    { href: "/finance/year-end", label: "Year-end close", permission: "finance.view" },
    { href: "/assets", label: "Fixed assets", permission: "assets.view" },
    { href: "/investments", label: "Investments", permission: "investments.view" },
  ] },
  { id: "people", title: "People & HR", icon: "users", items: [
    { href: "/hr/employees", label: "Staff directory", permission: "hr.view" },
    { href: "/hr/applications", label: "Job applications", permission: "hr.view" },
    { href: "/hr/onboarding", label: "Onboarding approvals", permission: "hr.view" },
    { href: "/hr/circulars", label: "Circulars", permission: "circulars.send" },
    { href: "/hr/attendance", label: "Staff attendance", permission: "attendance.view_all" },
    { href: "/hr/leave", label: "Staff leave", permission: "leave.approve" },
    { href: "/hr/reports", label: "Staff daily reports", permission: "leave.approve" },
    { href: "/hr/reports/eod", label: "End-of-day report", permission: "attendance.view_all" },
    { href: "/hr/scorecards", label: "Scorecards", permission: "attendance.view_all" },
    { href: "/hr/visits", label: "Staff site visits", permission: "attendance.view_all" },
    { href: "/hr/documents", label: "Employee documents", permission: "hr.view_sensitive" },
    { href: "/hr/requests", label: "Employee requests", permission: "hr.manage" },
    { href: "/payroll", label: "Payroll", permission: "payroll.view" },
    { href: "/hr/monitoring", label: "Team time tracking", permission: "monitoring.view_team" },
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
  { id: "admin", title: "Administration", icon: "settings", items: [
    { href: "/users", label: "Users", permission: "users.view" },
    { href: "/roles", label: "Roles & permissions", permission: "roles.manage" },
    { href: "/settings/company", label: "Company settings", permission: "settings.company.view" },
    { href: "/settings/calendar", label: "Working calendar", permission: "settings.company.view" },
    { href: "/settings/organization", label: "Offices & departments", permission: "users.view" },
    { href: "/settings/bank-accounts", label: "Bank accounts", permission: "bank.view" },
    { href: "/settings/documents", label: "Document templates", permission: "settings.company.view" },
    { href: "/settings/exchange-rates", label: "Exchange rates", permission: "reports.view" },
    { href: "/settings/tax-rates", label: "Tax rates", permission: "settings.company.view" },
    { href: "/settings/duplicates", label: "Duplicate leads", permission: "crm.duplicates" },
    { href: "/settings/quest", label: "Sales quest", permission: "crm.quest_settings" },
    { href: "/settings/integrations", label: "Integrations", permission: "integrations.manage" },
    { href: "/settings/email", label: "Email", permission: "settings.company.view" },
    { href: "/settings/mailboxes", label: "Mailboxes", permission: "mail.manage" },
    { href: "/settings/email-templates", label: "Email templates", permission: "email_templates.manage" },
    { href: "/settings/monitoring", label: "Monitoring policy", permission: "monitoring.configure" },
    { href: "/settings/jobs", label: "Scheduled jobs", permission: "jobs.run" },
    { href: "/audit-logs", label: "Audit logs", permission: "audit.view" },
    { href: "/settings/security", label: "Security checklist", permission: "audit.view" },
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
  return NAV.map((g) => ({ id: g.id, title: g.title, icon: g.icon, items: g.items.filter((i) => i.permission === null || permissions.has(i.permission)).map((i) => ({ href: i.href, label: i.label })) })).filter((g) => g.items.length > 0);
}
