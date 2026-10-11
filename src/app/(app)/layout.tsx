import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { logout, requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { unreadCount } from "@/lib/notifications";
import type { PermissionKey } from "@/lib/permissions";

type NavItem = { href: string; label: string; permission: PermissionKey };
type NavGroup = { title: string; items: NavItem[] };

// Menu items render only when the user holds the permission. Pages and actions
// re-check on the server, so hiding a link is never the only protection.
const NAV: NavGroup[] = [
  { title: "Overview", items: [{ href: "/dashboard", label: "Dashboard", permission: "dashboard.view" }] },
  {
    title: "CRM & Sales",
    items: [
      { href: "/leads", label: "Leads", permission: "crm.view" },
      { href: "/pipeline", label: "Pipeline", permission: "crm.view" },
      { href: "/leads/worklists", label: "Prospecting Worklists", permission: "crm.view" },
    ],
  },
  {
    title: "Services & Clients",
    items: [
      { href: "/services", label: "Service Catalog & Pricing", permission: "catalog.view" },
      { href: "/clients", label: "Client Accounts", permission: "clients.view" },
      { href: "/finance/invoices", label: "Invoices", permission: "finance.view" },
      { href: "/finance/payments", label: "Payments & Receipts", permission: "finance.view" },
    ],
  },
  {
    title: "My Work",
    items: [
      { href: "/me/attendance", label: "My Attendance", permission: "self.attendance" },
      { href: "/me/leave", label: "My Leave", permission: "self.leave" },
      { href: "/me/documents", label: "My Documents", permission: "self.leave" },
      { href: "/me/payslips", label: "My Payslips", permission: "self.payslip" },
      { href: "/expenses", label: "Expense Vouchers", permission: "self.expense" },
    ],
  },
  {
    title: "People & HR",
    items: [
      { href: "/hr/employees", label: "Employees", permission: "hr.view" },
      { href: "/hr/attendance", label: "Attendance (all)", permission: "attendance.view_all" },
      { href: "/payroll", label: "Payroll", permission: "payroll.view" },
    ],
  },
  {
    title: "Project Operations",
    items: [
      { href: "/projects", label: "Projects & Tasks", permission: "projects.view" },
      { href: "/content", label: "Content Calendar", permission: "content.view" },
    ],
  },
  {
    title: "Procurement & Vendors",
    items: [
      { href: "/vendors", label: "Vendor Directory", permission: "vendors.view" },
      { href: "/procurement", label: "Opportunities, Orders & Bills", permission: "vendors.view" },
    ],
  },
  {
    title: "Finance & Accounting",
    items: [
      { href: "/finance/ledger", label: "General Ledger", permission: "finance.view" },
      { href: "/finance/journals", label: "Manual Journals", permission: "finance.view" },
      { href: "/finance/accounts", label: "Chart of Accounts", permission: "finance.view" },
      { href: "/finance/close", label: "Close Periods", permission: "finance.view" },
      { href: "/finance/reports", label: "Financial Reports", permission: "reports.view" },
      { href: "/finance/budgets", label: "Budgets", permission: "budget.view" },
      { href: "/assets", label: "Fixed Assets", permission: "assets.view" },
      { href: "/investments", label: "Investments", permission: "investments.view" },
    ],
  },
  {
    title: "Analytics & Administration",
    items: [
      { href: "/settings/company", label: "Company Settings", permission: "settings.company.view" },
      { href: "/settings/bank-accounts", label: "Bank Accounts", permission: "bank.view" },
      { href: "/settings/documents", label: "Document Templates", permission: "settings.company.view" },
      { href: "/users", label: "Users", permission: "users.view" },
      { href: "/roles", label: "Roles & Permissions", permission: "roles.manage" },
      { href: "/audit-logs", label: "Audit Logs", permission: "audit.view" },
    ],
  },
];

async function signOut() {
  "use server";
  await logout();
  redirect("/login");
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // The layout must not redirect (it would loop back to the password page); every page redirects on its own
  const user = await requireUser({ allowMustChange: true });
  const unread = await unreadCount(db, user.id);
  const groups = NAV.map((g) => ({ ...g, items: g.items.filter((i) => user.permissions.has(i.permission)) })).filter(
    (g) => g.items.length > 0,
  );
  return (
    <div className="min-h-screen md:flex">
      <aside className="bg-navy text-white md:w-64 md:min-h-screen p-4 space-y-6">
        <div className="flex items-center gap-3">
          <Image src="/logo.png" alt="Hifi One" width={36} height={36} className="rounded-md" />
          <span className="font-bold tracking-tight">Hifi One</span>
        </div>
        <nav className="space-y-5" aria-label="Main">
          {groups.map((g) => (
            <div key={g.title}>
              <p className="text-[11px] uppercase tracking-wider text-white/50 mb-1">{g.title}</p>
              <ul className="space-y-0.5">
                {g.items.map((i) => (
                  <li key={i.href}>
                    <Link href={i.href} className="block rounded-md px-3 py-2 text-sm text-white/85 hover:bg-white/10">
                      {i.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </aside>
      <div className="flex-1 min-w-0">
        <header className="flex items-center justify-between gap-3 border-b border-border bg-surface px-6 py-3">
          <p className="text-sm text-muted">Hifi Marketing and Technologies</p>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <p className="text-sm font-semibold leading-tight">{user.name}</p>
              <p className="text-xs text-muted">{user.roles.join(", ")}</p>
            </div>
            <Link href="/notifications" className="text-sm relative" aria-label={`Notifications, ${unread} unread`}>
              <span aria-hidden>🔔</span>{unread > 0 && <span className="ml-1 rounded-full bg-brand px-1.5 py-0.5 text-[11px] font-semibold text-white">{unread}</span>}
            </Link>
            <Link href="/account/security" className="text-xs text-muted hover:underline">Security</Link>
            <Link href="/account/password" className="text-xs text-muted hover:underline">Password</Link>
            <form action={signOut}>
              <button className="btn-ghost">Sign out</button>
            </form>
          </div>
        </header>
        <main className="p-6 max-w-6xl">{children}</main>
      </div>
    </div>
  );
}
