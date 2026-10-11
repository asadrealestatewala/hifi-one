import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { loadExecutiveDashboard } from "@/lib/dashboard";
import { formatMoney } from "@/lib/money";

export const dynamic = "force-dynamic";

const Card = ({ href, label, children, hint }: { href?: string; label: string; children: React.ReactNode; hint?: string }) => {
  const inner = (
    <div className="card h-full hover:ring-2 hover:ring-brand/40 transition">
      <p className="text-xs font-semibold text-muted">{label}</p>
      <div className="mt-1">{children}</div>
      {hint && <p className="text-xs text-muted mt-1">{hint}</p>}
    </div>
  );
  return href ? <Link href={href} className="block">{inner}</Link> : inner;
};

export default async function Dashboard() {
  const user = await requirePermission("dashboard.view");
  if (!user.permissions.has("dashboard.executive")) {
    const [users, branches, banks] = await Promise.all([
      db.user.count({ where: { organizationId: user.organizationId, active: true } }),
      db.branch.count({ where: { organizationId: user.organizationId, active: true } }),
      db.bankAccount.count({ where: { organizationId: user.organizationId, active: true } }),
    ]);
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Welcome, {user.name}</h1>
          <p className="text-sm text-muted">Use the menu on the left for the tools your role can access.</p>
        </div>
        {user.permissions.has("users.view") && (
          <div className="grid gap-4 sm:grid-cols-3">
            <Card label="Active users"><p className="text-3xl font-bold">{users}</p></Card>
            <Card label="Branches"><p className="text-3xl font-bold">{branches}</p></Card>
            <Card label="Bank accounts"><p className="text-3xl font-bold">{banks}</p></Card>
          </div>
        )}
      </div>
    );
  }

  const d = await loadExecutiveDashboard(db, user.organizationId);
  const att = d.attention;
  const todo = [
    { n: att.vouchers, label: "expense vouchers in progress", href: "/expenses" },
    { n: att.bills, label: "vendor bills in progress", href: "/procurement" },
    { n: att.payrollRuns, label: "payroll runs not yet paid", href: "/payroll" },
    { n: att.leave, label: "leave requests awaiting a decision", href: "/me/leave" },
    { n: att.transfers, label: "budget transfers awaiting approval", href: "/finance/budgets" },
    { n: d.overdueInvoices, label: "overdue customer invoices", href: "/finance/reports?type=aging" },
    { n: d.overdueTasks, label: "overdue tasks", href: "/projects" },
    { n: d.openSessions, label: "attendance sessions left open", href: "/hr/attendance" },
    { n: d.contractsEnding, label: "contracts ending within 30 days", href: "/contracts" },
    { n: d.subsDue, label: "subscriptions due for billing", href: "/finance/subscriptions" },
    { n: d.expiringDocs, label: "employee documents expired or expiring within 30 days", href: "/hr/employees" },
  ].filter((t) => t.n > 0);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Executive dashboard</h1>
        <p className="text-sm text-muted">Figures come straight from the ledger and records, for the current calendar month unless stated. Each currency is shown separately. Select a card to see the detail.</p>
      </div>

      {d.money.length === 0 && <div className="card text-sm text-muted">No financial postings yet.</div>}
      {d.money.map((m) => (
        <section key={m.currency} className="space-y-2">
          <h2 className="text-sm font-semibold text-muted">{m.currency}</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            <Card href="/finance/reports?type=pl" label="Revenue this month"><p className="text-xl font-bold break-words">{formatMoney(m.revenue, m.currency)}</p></Card>
            <Card href="/finance/reports?type=pl" label="Net profit this month"><p className="text-xl font-bold break-words">{formatMoney(m.netProfit, m.currency)}</p></Card>
            <Card href="/finance/reports?type=cash" label="Cash and bank"><p className="text-xl font-bold break-words">{formatMoney(m.cash, m.currency)}</p></Card>
            <Card href="/finance/reports?type=aging" label="Owed by customers"><p className="text-xl font-bold break-words">{formatMoney(m.receivables, m.currency)}</p></Card>
            <Card href="/finance/ledger" label="Accounts payable"><p className="text-xl font-bold break-words">{formatMoney(m.payables, m.currency)}</p></Card>
          </div>
        </section>
      ))}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card href="/pipeline" label="Open pipeline value" hint="Leads not yet won or lost">
          {d.pipeline.length === 0 ? <p className="text-2xl font-bold">0</p> : d.pipeline.map((p) => <p key={p.currency} className="text-lg font-bold">{formatMoney(p.value, p.currency)} <span className="text-xs font-normal text-muted">({p.count})</span></p>)}
        </Card>
        <Card href="/projects" label="Active projects"><p className="text-2xl font-bold">{d.activeProjects}</p></Card>
        <Card href="/hr/employees" label="Active employees"><p className="text-2xl font-bold">{d.employees}</p></Card>
        <Card href="/projects" label="Overdue tasks"><p className="text-2xl font-bold">{d.overdueTasks}</p></Card>
      </div>

      <section className="card space-y-2">
        <h2 className="font-semibold">Needs attention</h2>
        {todo.length === 0 && d.budgetAlerts.length === 0 && <p className="text-sm text-muted">Nothing needs attention right now.</p>}
        <ul className="text-sm space-y-1">
          {todo.map((t) => <li key={t.label}><Link href={t.href} className="underline"><strong>{t.n}</strong> {t.label}</Link></li>)}
          {d.budgetAlerts.map((b) => <li key={b.id}><Link href="/finance/budgets" className="underline text-brand"><strong>{b.name}</strong> budget is at {b.pct}%{b.over ? " (over budget)" : ""}</Link></li>)}
        </ul>
      </section>
    </div>
  );
}
