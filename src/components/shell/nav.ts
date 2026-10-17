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
  ] },
  { id: "crm", title: "CRM & Sales", icon: "target", items: [
    { href: "/contacts", label: "Contacts", permission: "crm.view" },
    { href: "/leads", label: "Leads", permission: "crm.view" },
    { href: "/pipeline", label: "Opportunities", permission: "crm.view" },
    { href: "/leads/lists", label: "Smart Lists", permission: "crm.view" },
    { href: "/leads/worklists", label: "Prospecting Worklists", permission: "crm.view" },
    { href: "/campaigns", label: "Campaigns", permission: "campaigns.view" },
    { href: "/sales/activity", label: "Sales Activity & Targets", permission: "crm.view" },
    { href: "/sales/leads-report", label: "Leads Report", permission: "crm.view" },
    { href: "/quotes", label: "Proposals & Quotations", permission: "quotes.view" },
  ] },
  { id: "clients", title: "Services & Clients", icon: "layers", items: [
    { href: "/services", label: "Service Catalog", permission: "catalog.view" },
    { href: "/clients", label: "Customers", permission: "clients.view" },
    { href: "/contracts", label: "Contracts", permission: "contracts.view" },
    { href: "/finance/subscriptions", label: "Subscriptions", permission: "finance.view" },
    { href: "/finance/invoices", label: "Invoices", permission: "finance.view" },
    { href: "/finance/payments", label: "Payments & Receipts", permission: "finance.view" },
  ] },
  { id: "projects", title: "Project Operations", icon: "briefcase", items: [
    { href: "/projects", label: "Projects & Tasks", permission: "projects.view" },
    { href: "/content", label: "Content Calendar", permission: "content.view" },
    { href: "/meetings", label: "Meetings & Workshops", permission: "meetings.use" },
  ] },
  { id: "finance", title: "Finance & Accounting", icon: "wallet", items: [
    { href: "/finance/ledger", label: "General Ledger", permission: "finance.view" },
    { href: "/finance/accounts", label: "Chart of Accounts", permission: "finance.view" },
    { href: "/finance/journals", label: "Manual Journals", permission: "finance.view" },
    { href: "/finance/reconciliation", label: "Bank Reconciliation", permission: "bank.reconcile" },
    { href: "/finance/budgets", label: "Budgets", permission: "budget.view" },
    { href: "/finance/commissions", label: "Commissions", permission: "commissions.manage" },
    { href: "/finance/reports", label: "Financial Reports", permission: "reports.view" },
    { href: "/finance/close", label: "Close Periods", permission: "finance.view" },
    { href: "/finance/year-end", label: "Year-End Close", permission: "finance.view" },
    { href: "/assets", label: "Fixed Assets", permission: "assets.view" },
    { href: "/investments", label: "Investments", permission: "investments.view" },
  ] },
  { id: "people", title: "People & HR", icon: "users", items: [
    { href: "/hr/employees", label: "Staff Directory", permission: "hr.view" },
    { href: "/hr/attendance", label: "Attendance (all)", permission: "attendance.view_all" },
    { href: "/payroll", label: "Payroll", permission: "payroll.view" },
    { href: "/hr/monitoring", label: "Workfolio", permission: "monitoring.view_team" },
  ] },
  { id: "vendors", title: "Procurement & Vendors", icon: "truck", items: [
    { href: "/vendors", label: "Vendors", permission: "vendors.view" },
    { href: "/procurement", label: "Orders & Bills", permission: "vendors.view" },
  ] },
  { id: "me", title: "My Space", icon: "user", items: [
    { href: "/me/profile", label: "My Profile", permission: null },
    { href: "/me/help", label: "Help & Guide", permission: null },
    { href: "/account/security", label: "Account Security", permission: null },
    { href: "/me/attendance", label: "My Attendance", permission: "self.attendance" },
    { href: "/me/leave", label: "My Leave", permission: "self.leave" },
    { href: "/me/payslips", label: "My Payroll", permission: "self.payslip" },
    { href: "/me/tasks", label: "My Tasks", permission: null },
    { href: "/me/time", label: "My Workfolio", permission: "monitoring.own" },
    { href: "/expenses", label: "Expense Vouchers", permission: "self.expense" },
    { href: "/me/commissions", label: "My Commissions", permission: "commissions.own" },
    { href: "/me/documents", label: "My Documents", permission: "self.leave" },
    { href: "/me/calendar", label: "Calendar Feed", permission: "self.leave" },
    { href: "/assistant", label: "Assistant", permission: "assistant.use" },
  ] },
  { id: "admin", title: "Administration", icon: "settings", items: [
    { href: "/users", label: "Users", permission: "users.view" },
    { href: "/roles", label: "Roles & Permissions", permission: "roles.manage" },
    { href: "/settings/company", label: "Company Settings", permission: "settings.company.view" },
    { href: "/settings/organization", label: "Offices & Departments", permission: "users.view" },
    { href: "/settings/bank-accounts", label: "Bank Accounts", permission: "bank.view" },
    { href: "/settings/documents", label: "Document Templates", permission: "settings.company.view" },
    { href: "/settings/exchange-rates", label: "Exchange Rates", permission: "reports.view" },
    { href: "/settings/tax-rates", label: "Tax Rates", permission: "settings.company.view" },
    { href: "/settings/email", label: "Email", permission: "settings.company.view" },
    { href: "/settings/monitoring", label: "Monitoring Policy", permission: "monitoring.configure" },
    { href: "/settings/jobs", label: "Scheduled Jobs", permission: "jobs.run" },
    { href: "/audit-logs", label: "Audit Logs", permission: "audit.view" },
    { href: "/settings/security", label: "Security Checklist", permission: "audit.view" },
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
