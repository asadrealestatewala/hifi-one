import Link from "next/link";
import type { ReactNode } from "react";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { loadExecutiveDashboard } from "@/lib/dashboard";
import { loadLayout } from "@/lib/dashboard-layout";
import { availableWidgets } from "@/lib/dashboard-widgets";
import { questFor } from "@/lib/crm-contacts";
import { formatMoney } from "@/lib/money";
import { PageHeader } from "@/components/ui";
import QuestCard from "../contacts/QuestCard";
import DashboardGrid, { type GridWidget } from "./DashboardGrid";

export const dynamic = "force-dynamic";

const Card = ({ href, label, children, hint }: { href?: string; label: string; children: ReactNode; hint?: string }) => {
  const inner = (
    <div className="card h-full transition hover:ring-2 hover:ring-primary/30">
      <p className="text-xs font-semibold text-muted">{label}</p>
      <div className="mt-1">{children}</div>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
  return href ? <Link href={href} className="block h-full">{inner}</Link> : inner;
};

const Panel = ({ title, href, children }: { title: string; href?: string; children: ReactNode }) => (
  <div className="card h-full space-y-2">
    <div className="flex items-center justify-between"><h2 className="font-semibold">{title}</h2>{href && <Link href={href} className="text-xs text-primary hover:underline">See all</Link>}</div>
    {children}
  </div>
);
const none = (t: string) => <p className="text-sm text-muted">{t}</p>;

export default async function Dashboard() {
  const user = await requirePermission("dashboard.view");
  const org = user.organizationId;
  const avail = availableWidgets(user.permissions);
  const layout = await loadLayout(db, user.id, avail.map((w) => w.id));
  const visible = new Set(avail.map((w) => w.id).filter((id) => !layout.hidden.includes(id)));
  const now = new Date();
  const nodes = new Map<string, ReactNode>();
  const tasks: Promise<void>[] = [];

  if (visible.has("quest")) tasks.push((async () => {
    const quest = await questFor(db, { organizationId: org, userId: user.id });
    nodes.set("quest", <QuestCard name={user.name} {...quest} />);
  })());
  if (visible.has("followups")) tasks.push((async () => {
    const rows = await db.lead.findMany({ where: { organizationId: org, assignedToId: user.id, nextFollowUp: { lte: new Date(now.getTime() + 86400000) }, stage: { isWon: false, isLost: false } }, orderBy: { nextFollowUp: "asc" }, take: 6, select: { id: true, name: true, number: true, nextFollowUp: true } });
    nodes.set("followups", <Panel title="Follow-ups due" href="/leads">{rows.length === 0 ? none("Nothing due today. Nice.") : <ul className="divide-y divide-border text-sm">{rows.map((l) => <li key={l.id} className="flex items-center justify-between gap-2 py-1.5"><Link href={`/leads/${l.id}`} className="font-medium hover:underline">{l.name}</Link><span className={l.nextFollowUp! < now ? "text-brand" : "text-muted"}>{l.nextFollowUp!.toLocaleDateString()}{l.nextFollowUp! < now ? " · overdue" : ""}</span></li>)}</ul>}</Panel>);
  })());
  if (visible.has("tasks")) tasks.push((async () => {
    const rows = await db.task.findMany({ where: { assigneeId: user.id, status: { not: "DONE" }, project: { organizationId: org } }, orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }], take: 6, select: { id: true, title: true, status: true, dueDate: true, projectId: true } });
    nodes.set("tasks", <Panel title="My tasks" href="/projects">{rows.length === 0 ? none("No open tasks assigned to you.") : <ul className="divide-y divide-border text-sm">{rows.map((t) => <li key={t.id} className="flex items-center justify-between gap-2 py-1.5"><Link href={`/projects/${t.projectId}`} className="truncate font-medium hover:underline">{t.title}</Link><span className={t.dueDate && t.dueDate < now ? "shrink-0 text-brand" : "shrink-0 text-muted"}>{t.dueDate ? t.dueDate.toLocaleDateString() : t.status.toLowerCase().replace("_", " ")}</span></li>)}</ul>}</Panel>);
  })());
  if (visible.has("meetings")) tasks.push((async () => {
    const rows = await db.meeting.findMany({ where: { organizationId: org, status: { in: ["SCHEDULED", "LIVE"] }, OR: [{ hostId: user.id }, { participants: { some: { userId: user.id } } }] }, orderBy: { scheduledAt: { sort: "asc", nulls: "first" } }, take: 5, select: { id: true, title: true, status: true, scheduledAt: true } });
    nodes.set("meetings", <Panel title="Upcoming meetings" href="/meetings">{rows.length === 0 ? none("No meetings coming up.") : <ul className="divide-y divide-border text-sm">{rows.map((m) => <li key={m.id} className="flex items-center justify-between gap-2 py-1.5"><Link href={`/meetings/${m.id}`} className="truncate font-medium hover:underline">{m.title}</Link><span className={m.status === "LIVE" ? "font-medium text-success" : "text-muted"}>{m.status === "LIVE" ? "live now" : m.scheduledAt ? m.scheduledAt.toLocaleString() : "unscheduled"}</span></li>)}</ul>}</Panel>);
  })());
  if (visible.has("contacts")) tasks.push((async () => {
    const manager = user.permissions.has("crm.view_all");
    const rows = await db.contact.findMany({ where: { organizationId: org, archived: false, ...(manager ? {} : { OR: [{ ownerId: user.id }, { createdById: user.id }, { followers: { has: user.id } }] }) }, orderBy: { createdAt: "desc" }, take: 6, select: { id: true, name: true, category: true, createdAt: true } });
    nodes.set("contacts", <Panel title="Recently added contacts" href="/contacts">{rows.length === 0 ? none("No contacts yet.") : <ul className="divide-y divide-border text-sm">{rows.map((c) => <li key={c.id} className="flex items-center justify-between gap-2 py-1.5"><Link href={`/contacts/${c.id}`} className="truncate font-medium hover:underline">{c.name}</Link><span className="text-muted">{c.category.toLowerCase()}</span></li>)}</ul>}</Panel>);
  })());
  if (visible.has("org")) tasks.push((async () => {
    const [users, branches, banks] = await Promise.all([
      db.user.count({ where: { organizationId: org, active: true } }),
      db.branch.count({ where: { organizationId: org, active: true } }),
      db.bankAccount.count({ where: { organizationId: org, active: true } }),
    ]);
    nodes.set("org", <div className="grid gap-4 sm:grid-cols-3"><Card label="Active users"><p className="text-3xl font-bold">{users}</p></Card><Card label="Branches"><p className="text-3xl font-bold">{branches}</p></Card><Card label="Bank accounts"><p className="text-3xl font-bold">{banks}</p></Card></div>);
  })());
  if (["money", "kpis", "attention"].some((id) => visible.has(id))) tasks.push((async () => {
    const d = await loadExecutiveDashboard(db, org);
    if (visible.has("money")) {
      nodes.set("money", d.money.length === 0 ? <div className="card text-sm text-muted">No financial postings yet.</div> : (
        <div className="space-y-3">
          {d.money.map((m) => (
            <div key={m.currency} className="space-y-1.5">
              <h2 className="text-sm font-semibold text-muted">{m.currency}, this month</h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
                <Card href="/finance/reports?type=pl" label="Revenue"><p className="break-words text-xl font-bold">{formatMoney(m.revenue, m.currency)}</p></Card>
                <Card href="/finance/reports?type=pl" label="Net profit"><p className="break-words text-xl font-bold">{formatMoney(m.netProfit, m.currency)}</p></Card>
                <Card href="/finance/reports?type=cash" label="Cash and bank"><p className="break-words text-xl font-bold">{formatMoney(m.cash, m.currency)}</p></Card>
                <Card href="/finance/reports?type=aging" label="Owed by customers"><p className="break-words text-xl font-bold">{formatMoney(m.receivables, m.currency)}</p></Card>
                <Card href="/finance/ledger" label="Accounts payable"><p className="break-words text-xl font-bold">{formatMoney(m.payables, m.currency)}</p></Card>
              </div>
            </div>
          ))}
        </div>
      ));
    }
    if (visible.has("kpis")) {
      nodes.set("kpis", (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card href="/pipeline" label="Open pipeline value" hint="Leads not yet won or lost">
            {d.pipeline.length === 0 ? <p className="text-2xl font-bold">0</p> : d.pipeline.map((p) => <p key={p.currency} className="text-lg font-bold">{formatMoney(p.value, p.currency)} <span className="text-xs font-normal text-muted">({p.count})</span></p>)}
          </Card>
          <Card href="/projects" label="Active projects"><p className="text-2xl font-bold">{d.activeProjects}</p></Card>
          <Card href="/hr/employees" label="Active employees"><p className="text-2xl font-bold">{d.employees}</p></Card>
          <Card href="/projects" label="Overdue tasks"><p className="text-2xl font-bold">{d.overdueTasks}</p></Card>
        </div>
      ));
    }
    if (visible.has("attention")) {
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
      nodes.set("attention", (
        <section className="card space-y-2">
          <h2 className="font-semibold">Needs attention</h2>
          {todo.length === 0 && d.budgetAlerts.length === 0 && <p className="text-sm text-muted">Nothing needs attention right now.</p>}
          <ul className="space-y-1 text-sm">
            {todo.map((t) => <li key={t.label}><Link href={t.href} className="underline"><strong>{t.n}</strong> {t.label}</Link></li>)}
            {d.budgetAlerts.map((b) => <li key={b.id}><Link href="/finance/budgets" className="text-brand underline"><strong>{b.name}</strong> budget is at {b.pct}%{b.over ? " (over budget)" : ""}</Link></li>)}
          </ul>
        </section>
      ));
    }
  })());

  await Promise.all(tasks);
  const widgets: GridWidget[] = avail.map((w) => ({ id: w.id, title: w.title, wide: w.wide, node: nodes.get(w.id) ?? null }));
  const hour = now.getHours();
  const greet = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  return (
    <div className="space-y-5">
      <PageHeader title={`${greet}, ${user.name.split(" ")[0]}`} subtitle="Your day at a glance. Figures come straight from the ledger and records, with each currency shown separately." />
      {avail.length === 0 ? <div className="card text-sm text-muted">Use the menu for the tools your role can access.</div> : <DashboardGrid key={`${layout.order.join(",")}|${layout.hidden.join(",")}`} widgets={widgets} order={layout.order} hidden={layout.hidden} />}
    </div>
  );
}
