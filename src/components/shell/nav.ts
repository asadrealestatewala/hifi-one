import type { PermissionKey } from "@/lib/permissions";

export type NavItem = { href: string; label: string; permission: PermissionKey };
export type NavGroup = { id: string; title: string; icon: string; items: NavItem[] };

// Menu items render only when the user holds the permission. Pages and actions re-check on the server,
// so hiding a link is never the only protection.
export const NAV: NavGroup[] = [
  { id: "overview", title: "Overview", icon: "home", items: [
    { href: "/dashboard", label: "Dashboard", permission: "dashboard.view" },
    { href: "/search", label: "Search", permission: "dashboard.view" },
  ] },
  { id: "crm", title: "CRM & Sales", icon: "target", items: [
    { href: "/leads", label: "Leads", permission: "crm.view" },
    { href: "/pipeline", label: "Opportunities", permission: "crm.view" },
    { href: "/leads/worklists", label: "Prospecting Worklists", permission: "crm.view" },
    { href: "/quotes", label: "Proposals & Quotations", permission: "quotes.view" },
  ] },
  { id: "clients", title: "Services & Clients", icon: "layers", items: [
    { href: "/services", label: "Service Catalog", permission: "catalog.view" },
    { href: "/clients", label: "Client Accounts", permission: "clients.view" },
    { href: "/contracts", label: "Contracts", permission: "contracts.view" },
    { href: "/finance/subscriptions", label: "Subscriptions", permission: "finance.view" },
    { href: "/finance/invoices", label: "Invoices", permission: "finance.view" },
    { href: "/finance/payments", label: "Payments & Receipts", permission: "finance.view" },
  ] },
  { id: "projects", title: "Project Operations", icon: "briefcase", items: [
    { href: "/projects", label: "Projects & Tasks", permission: "projects.view" },
    { href: "/content", label: "Content Calendar", permission: "content.view" },
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
    { href: "/hr/employees", label: "Employees", permission: "hr.view" },
    { href: "/hr/attendance", label: "Attendance (all)", permission: "attendance.view_all" },
    { href: "/payroll", label: "Payroll", permission: "payroll.view" },
  ] },
  { id: "vendors", title: "Procurement & Vendors", icon: "truck", items: [
    { href: "/vendors", label: "Vendor Directory", permission: "vendors.view" },
    { href: "/procurement", label: "Orders & Bills", permission: "vendors.view" },
  ] },
  { id: "me", title: "My Workspace", icon: "user", items: [
    { href: "/me/attendance", label: "My Attendance", permission: "self.attendance" },
    { href: "/me/leave", label: "My Leave", permission: "self.leave" },
    { href: "/me/payslips", label: "My Payslips", permission: "self.payslip" },
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
  { href: "/expenses", label: "New expense voucher", permission: "self.expense", icon: "wallet" },
  { href: "/me/leave", label: "Request leave", permission: "self.leave", icon: "calendar" },
];
