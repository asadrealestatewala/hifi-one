import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { logout, requireUser } from "@/lib/auth";
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
    title: "Finance & Accounting",
    items: [{ href: "/finance/ledger", label: "General Ledger", permission: "finance.view" }],
  },
  {
    title: "Analytics & Administration",
    items: [
      { href: "/settings/company", label: "Company Settings", permission: "settings.company.view" },
      { href: "/settings/bank-accounts", label: "Bank Accounts", permission: "bank.view" },
      { href: "/users", label: "Users & Roles", permission: "users.view" },
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
  const user = await requireUser();
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
