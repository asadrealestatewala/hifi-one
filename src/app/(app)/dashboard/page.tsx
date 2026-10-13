import Link from "next/link";
import type { ReactNode } from "react";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { loadAttention, loadFlow, loadHero, loadProfitAndLoss, isPeriod, periodRange, PERIODS } from "@/lib/dashboard-home";
import { loadExecutiveDashboard } from "@/lib/dashboard";
import { loadLeadsReport } from "@/lib/leads-report";
import { loadLayout } from "@/lib/dashboard-layout";
import { availableWidgets } from "@/lib/dashboard-widgets";
import { leadScope } from "@/lib/leads";
import { questFor } from "@/lib/crm-contacts";
import { formatMoney } from "@/lib/money";
import Icon from "@/components/shell/Icon";
import { Avatar, Empty, Stat } from "@/components/ui";
import QuestCard from "../contacts/QuestCard";
import DashboardGrid, { type GridWidget } from "./DashboardGrid";
import LeadsReport from "./LeadsReport";
import PeriodSelect from "./PeriodSelect";
import { Bars, CardPanel, FlowChart, Row, money } from "./parts";

export const dynamic = "force-dynamic";

type SP = { tab?: string; period?: string; cur?: string };
const TABS = [["overview", "Overview", "home"], ["leads", "Leads & sales", "target"], ["finance", "Finance", "wallet"], ["people", "People", "users"], ["assets", "Assets", "layers"]] as const;

export default async function Dashboard({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePermission("dashboard.view");
  const sp = await searchParams;
  const org = user.organizationId;
  const has = (p: string) => user.permissions.has(p as never);
  const canLeads = has("crm.view"), canFinance = has("finance.view"), canPeople = has("hr.view") || has("attendance.view_all"), canAssets = has("assets.view");
  const canPL = has("reports.view") || has("dashboard.executive");
  const profile = await db.companyProfile.findFirst({ where: { organizationId: org, isDefault: true } });
  const now = new Date();
  const today = now.toLocaleDateString("en-CA", { timeZone: profile?.timezone ?? "UTC" });
  const period = isPeriod(sp.period) ? sp.period : "month";
  const range = periodRange(period, today);
  const visibleTabs = TABS.filter(([k]) => k === "overview" || (k === "leads" && canLeads) || (k === "finance" && canFinance) || (k === "people" && canPeople) || (k === "assets" && canAssets));
  const tab = visibleTabs.some(([k]) => k === sp.tab) ? sp.tab! : "overview";
  const leadWhere = canLeads ? leadScope(user) : null;

  const [hero, att] = await Promise.all([
    loadHero(db, org, range, now, canFinance, leadWhere),
    loadAttention(db, org, user, today, now, leadWhere),
  ]);
  const date = new Date(today + "T12:00:00Z").toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
  const greet = Number(now.toLocaleTimeString("en-GB", { hour: "2-digit", hour12: false, timeZone: profile?.timezone ?? "UTC" }).slice(0, 2));
  const hello = greet < 12 ? "Good morning" : greet < 18 ? "Good afternoon" : "Good evening";
  const href = (over: Record<string, string | undefined>) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries({ tab: tab === "overview" ? undefined : tab, period: period === "month" ? undefined : period, ...over })) if (v) p.set(k, v); const t = p.toString(); return `/dashboard${t ? `?${t}` : ""}`; };

  const actions: [string, string, string, boolean][] = [
    ["New lead", "/leads?new=1", "target", has("crm.edit")], ["Receive payment", "/finance/payments?new=1", "receipt", has("finance.post")], ["New voucher", "/expenses", "wallet", has("self.expense")],
    ["Mark attendance", "/me/attendance", "clock", has("self.attendance")], ["Leave requests", "/me/leave", "calendar", has("self.leave")], ["Asset library", "/assets", "layers", has("assets.view")],
    ["My tasks", "/me/tasks", "check", true], ["Ask the assistant", "/assistant", "sparkles", has("assistant.use")],
  ];

  let body: ReactNode;
  if (tab === "leads" && leadWhere) {
    const [report, staff] = await Promise.all([loadLeadsReport(db, org, leadWhere, range), db.user.findMany({ where: { organizationId: org, userType: "EMPLOYEE" }, select: { id: true, name: true } })]);
    body = (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-semibold">Leads report · {PERIODS[period].toLowerCase()}</h2><Link href={`/sales/leads-report${period === "month" ? "" : `?period=${period}`}`} className="btn-ghost">Open full report</Link></div>
        <LeadsReport r={report} owners={new Map(staff.map((s) => [s.id, s.name]))} from={range.from} to={range.to} />
      </div>
    );
  } else if (tab === "finance" && canFinance) {
    const [pl, ex, flow] = await Promise.all([canPL ? loadProfitAndLoss(db, org, range) : [], loadExecutiveDashboard(db, org), loadFlow(db, org, today)]);
    const cur = flow.find((f) => f.currency === sp.cur) ?? flow[0];
    const reportHref = `/finance/reports?type=pl&from=${range.from}&to=${range.to}`;
    body = (
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-semibold">Finance · {PERIODS[period].toLowerCase()}</h2>{has("reports.view") && <Link href={reportHref} className="btn-ghost">Open profit and loss report</Link>}</div>
        {canPL && (pl.length === 0 ? <Empty title="No postings in this period">Revenue and expenses appear here once invoices are issued and costs are posted.</Empty> : pl.map((p) => (
          <section key={p.currency} className="card space-y-3"><div className="flex items-center justify-between"><h3 className="font-semibold">Profit and loss, {p.currency}</h3><span className="text-xs text-muted">same figures as the Financial reports page</span></div>
            <dl className="grid gap-3 sm:grid-cols-5">{([["Revenue", p.revenue, false], ["Direct costs", p.direct, false], ["Gross profit", p.grossProfit, false], ["Operating expenses", p.opex, false], ["Net profit", p.netProfit, true]] as const).map(([l, v, strong]) => <div key={l} className={strong ? "rounded-xl bg-primary/10 p-3" : "rounded-xl bg-hover p-3"}><dt className="text-xs text-muted">{l}</dt><dd className={`mt-1 text-lg font-semibold tabular-nums ${strong && Number(v) < 0 ? "text-brand" : ""}`}>{formatMoney(v, p.currency)}</dd></div>)}</dl>
          </section>
        )))}
        <div className="grid gap-5 lg:grid-cols-2">
          <section className="card space-y-3"><div className="flex items-center justify-between"><h3 className="font-semibold">Collected and spent</h3>{flow.length > 1 && <span className="flex gap-1">{flow.map((f) => <Link key={f.currency} href={href({ cur: f.currency })} className={`rounded-full border px-2.5 py-0.5 text-xs ${f.currency === cur.currency ? "border-primary bg-primary text-white" : "border-border"}`}>{f.currency}</Link>)}</span>}</div>
            {cur ? <FlowChart data={cur.data} currency={cur.currency} /> : <p className="py-8 text-center text-sm text-muted">No payments or expenses yet.</p>}</section>
          <section className="card space-y-3"><h3 className="font-semibold">Position today</h3>
            {ex.money.length === 0 ? <p className="text-sm text-muted">No postings yet.</p> : ex.money.map((m) => <div key={m.currency}><p className="mb-1 text-xs font-medium text-muted">{m.currency}</p><dl className="grid grid-cols-3 gap-2 text-sm">{[["Cash and bank", m.cash], ["Owed by customers", m.receivables], ["Accounts payable", m.payables]].map(([l, v]) => <div key={l} className="rounded-xl bg-hover p-2.5"><dt className="text-[11px] text-muted">{l}</dt><dd className="mt-0.5 font-semibold tabular-nums">{formatMoney(v, m.currency)}</dd></div>)}</dl></div>)}
            <Link href="/finance/reports?type=aging" className="text-sm text-primary hover:underline">Receivables aging</Link></section>
        </div>
        {att.overdue && att.overdue.rows.length > 0 && <section className="card"><h3 className="mb-1 font-semibold">Most overdue invoices</h3>{att.overdue.rows.map((r) => <Row key={r.id} href={`/finance/invoices/${r.id}`} title={`${r.number} · ${r.client}`} sub={r.due ? `due ${r.due}` : undefined} right={formatMoney(r.outstanding, r.currency)} />)}</section>}
      </div>
    );
  } else if (tab === "people" && canPeople) {
    const monthStart = today.slice(0, 7);
    const [profiles, present, onLeave, pending, joiners, bdays, users] = await Promise.all([
      db.employeeProfile.count({ where: { organizationId: org, status: "ACTIVE" } }),
      db.attendanceRecord.findMany({ where: { workDate: today }, select: { userId: true } }),
      db.leaveRequest.findMany({ where: { status: "APPROVED", startDate: { lte: today }, endDate: { gte: today }, leaveType: { organizationId: org } }, select: { userId: true } }),
      db.leaveRequest.count({ where: { status: "PENDING", leaveType: { organizationId: org } } }),
      db.employeeProfile.findMany({ where: { organizationId: org, status: "ACTIVE", joinDate: { gte: new Date(now.getTime() - 30 * 86400000) } }, orderBy: { joinDate: "desc" }, take: 6, select: { userId: true, designation: true, joinDate: true } }),
      db.employeeProfile.findMany({ where: { organizationId: org, status: "ACTIVE", dateOfBirth: { contains: `-${monthStart.slice(5)}-` } }, select: { userId: true, dateOfBirth: true } }),
      db.user.findMany({ where: { organizationId: org, userType: "EMPLOYEE" }, select: { id: true, name: true } }),
    ]);
    const nm = new Map(users.map((u) => [u.id, u.name]));
    const presentToday = present.filter((r) => nm.has(r.userId)).length;
    body = (
      <div className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Stat label="Active staff" value={profiles} /><Stat label="Present today" value={presentToday} /><Stat label="Not marked" value={att.attendance?.count ?? "n/a"} hint="no attendance today" />
          <Stat label="On leave today" value={onLeave.length} /><Stat label="Leave to approve" value={pending} />
        </div>
        <div className="grid gap-5 lg:grid-cols-2">
          <section className="card"><h3 className="mb-1 font-semibold">Birthdays this month</h3>{bdays.length === 0 ? <p className="py-4 text-sm text-muted">None recorded for this month.</p> : bdays.sort((a, b) => (a.dateOfBirth ?? "").slice(8).localeCompare((b.dateOfBirth ?? "").slice(8))).map((b) => <div key={b.userId} className="flex items-center justify-between border-b border-border py-2 text-sm last:border-0"><span className="flex items-center gap-2"><Avatar name={nm.get(b.userId) ?? "?"} userId={b.userId} size={26} />{nm.get(b.userId)}</span><span className="text-muted">{b.dateOfBirth!.slice(8)} {new Date(today + "T00:00:00Z").toLocaleDateString(undefined, { month: "short", timeZone: "UTC" })}</span></div>)}</section>
          <section className="card"><h3 className="mb-1 font-semibold">New joiners, last 30 days</h3>{joiners.length === 0 ? <p className="py-4 text-sm text-muted">No new joiners.</p> : joiners.map((j) => <div key={j.userId} className="flex items-center justify-between border-b border-border py-2 text-sm last:border-0"><span className="flex items-center gap-2"><Avatar name={nm.get(j.userId) ?? "?"} userId={j.userId} size={26} />{nm.get(j.userId)}</span><span className="text-muted">{j.designation} · {j.joinDate?.toLocaleDateString()}</span></div>)}</section>
        </div>
        <div className="flex gap-2"><Link href="/hr/employees" className="btn-ghost">Employees</Link>{has("attendance.view_all") && <Link href="/hr/attendance" className="btn-ghost">Attendance</Link>}<Link href="/me/leave" className="btn-ghost">Leave</Link></div>
      </div>
    );
  } else if (tab === "assets" && canAssets) {
    const [assets, staff] = await Promise.all([db.asset.findMany({ where: { organizationId: org }, orderBy: { createdAt: "desc" }, take: 500 }), db.user.findMany({ where: { organizationId: org, userType: "EMPLOYEE" }, select: { id: true, name: true } })]);
    const active = assets.filter((a) => a.status === "ACTIVE");
    const cost = new Map<string, number>();
    for (const a of active) cost.set(a.currency, (cost.get(a.currency) ?? 0) + Number(a.cost));
    const nm = new Map(staff.map((s) => [s.id, s.name]));
    const byCat = new Map<string, number>();
    for (const a of active) byCat.set(a.category || "Uncategorised", (byCat.get(a.category || "Uncategorised") ?? 0) + 1);
    body = (
      <div className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Active assets" value={active.length} /><Stat label="Assigned to people" value={active.filter((a) => a.assignedToId).length} /><Stat label="In stock" value={active.filter((a) => !a.assignedToId).length} hint="not assigned" />
          <Stat label="Purchase cost" value={<span className="text-lg">{[...cost].map(([c, v]) => formatMoney(v.toFixed(2), c)).join(" · ") || "0"}</span>} />
        </div>
        <div className="grid gap-5 lg:grid-cols-2">
          <section className="card space-y-3"><h3 className="font-semibold">By category</h3>{byCat.size === 0 ? <p className="text-sm text-muted">No assets registered.</p> : <Bars rows={[...byCat].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([label, value]) => ({ label, value }))} />}</section>
          <section className="card"><h3 className="mb-1 font-semibold">Recently added</h3>{assets.slice(0, 6).map((a) => <Row key={a.id} href="/assets" title={a.name} sub={`${a.number}${a.assignedToId ? ` · ${nm.get(a.assignedToId) ?? ""}` : " · in stock"}`} right={formatMoney(a.cost, a.currency)} />)}{assets.length === 0 && <p className="py-4 text-sm text-muted">Nothing yet.</p>}</section>
        </div>
        <Link href="/assets" className="btn-ghost">Open the asset register</Link>
      </div>
    );
  } else {
    // Overview: the money chart, what needs attention, and the cards each person can arrange
    const [flow, layout, quest, tasks, meetings, contacts] = await Promise.all([
      canFinance ? loadFlow(db, org, today) : [],
      loadLayout(db, user.id, availableWidgets(user.permissions).map((w) => w.id)),
      canLeads ? questFor(db, { organizationId: org, userId: user.id }) : null,
      has("projects.view") ? db.task.findMany({ where: { assigneeId: user.id, status: { not: "DONE" }, project: { organizationId: org } }, orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }], take: 5, select: { id: true, title: true, dueDate: true, projectId: true } }) : [],
      has("meetings.use") ? db.meeting.findMany({ where: { organizationId: org, status: { in: ["SCHEDULED", "LIVE"] }, OR: [{ hostId: user.id }, { participants: { some: { userId: user.id } } }] }, orderBy: { scheduledAt: { sort: "asc", nulls: "first" } }, take: 5, select: { id: true, title: true, status: true, scheduledAt: true } }) : [],
      canLeads ? db.contact.findMany({ where: { organizationId: org, archived: false, ...(has("crm.view_all") ? {} : { OR: [{ ownerId: user.id }, { createdById: user.id }, { followers: { has: user.id } }] }) }, orderBy: { createdAt: "desc" }, take: 5, select: { id: true, name: true, category: true } }) : [],
    ]);
    const cur = flow.find((f) => f.currency === sp.cur) ?? flow[0];
    const need: { icon: string; tone: "primary" | "danger" | "warning"; n: number; text: string; sub?: string; href: string }[] = [
      att.followups && att.followups.count > 0 ? { icon: "phone", tone: "primary" as const, n: att.followups.count, text: "follow-ups due", sub: att.followups.rows[0]?.name, href: "/leads" } : null,
      att.overdue && att.overdue.count > 0 ? { icon: "receipt", tone: "danger" as const, n: att.overdue.count, text: "overdue invoices", sub: money(att.overdue.amounts), href: "/finance/reports?type=aging" } : null,
      att.vouchers && att.vouchers.count > 0 ? { icon: "wallet", tone: "primary" as const, n: att.vouchers.count, text: "vouchers awaiting approval", sub: att.vouchers.rows[0] ? `${att.vouchers.rows[0].number} · ${att.vouchers.rows[0].description}` : undefined, href: "/expenses" } : null,
      att.commissions && att.commissions.count > 0 ? { icon: "wallet", tone: "primary" as const, n: att.commissions.count, text: "commissions to approve", href: "/finance/commissions" } : null,
      att.attendance && att.attendance.count > 0 ? { icon: "clock", tone: "warning" as const, n: att.attendance.count, text: "attendance not marked today", sub: att.attendance.rows[0]?.name, href: "/hr/attendance" } : null,
      att.leave && att.leave.count > 0 ? { icon: "calendar", tone: "primary" as const, n: att.leave.count, text: "leave requests to decide", href: "/me/leave" } : null,
      att.posts && att.posts.count > 0 ? { icon: "calendar", tone: "primary" as const, n: att.posts.count, text: "posts to publish today", sub: att.posts.rows[0]?.title, href: "/content" } : null,
      att.myOverdueTasks > 0 ? { icon: "check", tone: "danger" as const, n: att.myOverdueTasks, text: "of your tasks are overdue", href: "/me/tasks" } : null,
    ].filter((x): x is NonNullable<typeof x> => x !== null);
    const tone = { primary: "bg-primary/10 text-primary", danger: "bg-brand/10 text-brand", warning: "bg-warning/10 text-warning" };

    const nodes = new Map<string, ReactNode>();
    if (att.followups) nodes.set("followups", <CardPanel icon="phone" title="Follow-ups due" count={att.followups.count} href="/leads" empty="Nothing due. Nice.">{att.followups.rows.length > 0 && att.followups.rows.map((f) => <Row key={f.id} href={`/leads/${f.id}`} title={f.name} sub={f.due && f.due < today ? `Was due ${f.due}` : "Call today"} />)}</CardPanel>);
    if (att.overdue) nodes.set("overdue", <CardPanel icon="receipt" tone="danger" title="Overdue invoices" subtitle={money(att.overdue.amounts)} count={att.overdue.count} href="/finance/reports?type=aging" empty="No overdue invoices.">{att.overdue.rows.length > 0 && <>{att.overdue.rows.map((r) => <Row key={r.id} href={`/finance/invoices/${r.id}`} title={r.client} sub={`${r.number}${r.due ? ` · due ${r.due}` : ""}`} right={formatMoney(r.outstanding, r.currency)} />)}{att.overdue.count > att.overdue.rows.length && <p className="pt-2 text-xs text-muted">+ {att.overdue.count - att.overdue.rows.length} more</p>}</>}</CardPanel>);
    if (att.vouchers) nodes.set("vouchers", <CardPanel icon="wallet" title="Vouchers awaiting approval" count={att.vouchers.count} href="/expenses" empty="Nothing waiting.">{att.vouchers.rows.length > 0 && att.vouchers.rows.map((v) => <Row key={v.id} href={`/expenses/${v.id}`} title={v.description} sub={v.number} right={formatMoney(v.amount, v.currency)} />)}</CardPanel>);
    if (att.commissions) nodes.set("commissions", <CardPanel icon="wallet" title="Commissions to approve" count={att.commissions.count} href="/finance/commissions" empty="Nothing waiting.">{att.commissions.count > 0 && <p className="py-8 text-center text-sm text-muted">{att.commissions.count} waiting</p>}</CardPanel>);
    if (att.attendance) nodes.set("attendance", <CardPanel icon="clock" tone="warning" title="Attendance not marked today" count={att.attendance.count} href="/hr/attendance" empty="Everyone has marked attendance.">{att.attendance.rows.length > 0 && <>{att.attendance.rows.map((p) => <Row key={p.id} href="/hr/attendance" title={<span className="flex items-center gap-2"><Avatar name={p.name} userId={p.id} size={22} />{p.name}</span>} sub="Mark present / absent" />)}{att.attendance.count > att.attendance.rows.length && <p className="pt-2 text-xs text-muted">+ {att.attendance.count - att.attendance.rows.length} more</p>}</>}</CardPanel>);
    if (att.posts) nodes.set("posts", <CardPanel icon="calendar" title="Posts to publish today" count={att.posts.count} href="/content" empty="Nothing to publish today.">{att.posts.rows.length > 0 && att.posts.rows.map((p) => <Row key={p.id} href={`/content/${p.id}`} title={p.title} sub={p.time ?? undefined} />)}</CardPanel>);
    if (has("projects.view")) nodes.set("tasks", <CardPanel icon="check" title="My tasks" count={tasks.length} href="/me/tasks" empty="No open tasks assigned to you.">{tasks.length > 0 && tasks.map((t) => <Row key={t.id} href={`/projects/${t.projectId}?task=${t.id}`} title={t.title} sub={t.dueDate ? `Due ${t.dueDate.toLocaleDateString()}` : "No due date"} />)}</CardPanel>);
    if (has("meetings.use")) nodes.set("meetings", <CardPanel icon="video" title="Upcoming meetings" count={meetings.length} href="/meetings" empty="No meetings coming up.">{meetings.length > 0 && meetings.map((m) => <Row key={m.id} href={`/meetings/${m.id}`} title={m.title} sub={m.status === "LIVE" ? "Live now" : m.scheduledAt?.toLocaleString() ?? "Unscheduled"} />)}</CardPanel>);
    if (canLeads) nodes.set("contacts", <CardPanel icon="users" title="Recently added contacts" href="/contacts" empty="No contacts yet.">{contacts.length > 0 && contacts.map((c) => <Row key={c.id} href={`/contacts/${c.id}`} title={c.name} right={<span className="text-xs text-muted">{c.category.toLowerCase()}</span>} />)}</CardPanel>);
    if (quest) nodes.set("quest", <QuestCard name={user.name} {...quest} />);
    const widgets: GridWidget[] = availableWidgets(user.permissions).map((w) => ({ id: w.id, title: w.title, wide: w.wide, node: nodes.get(w.id) ?? null }));

    body = (
      <div className="space-y-5">
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          {canFinance && (
            <section className="card space-y-3"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">Collected and spent</h2><span className="flex items-center gap-1.5">{hero.collected.length > 0 && <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">{money(hero.collected)} in</span>}{flow.length > 1 && flow.map((f) => <Link key={f.currency} href={href({ cur: f.currency })} className={`rounded-full border px-2.5 py-0.5 text-xs ${f.currency === cur?.currency ? "border-primary bg-primary text-white" : "border-border"}`}>{f.currency}</Link>)}</span></div>
              {cur ? <FlowChart data={cur.data} currency={cur.currency} /> : <p className="py-10 text-center text-sm text-muted">No payments or expenses yet.</p>}</section>
          )}
          <section className={`card !p-0 ${canFinance ? "" : "xl:col-span-2"}`}>
            <header className="flex items-center justify-between border-b border-border px-4 py-3"><h2 className="font-semibold">Needs attention</h2><span className="rounded-full bg-brand/10 px-2 text-xs font-semibold leading-5 text-brand">{att.total}</span></header>
            {need.length === 0 ? <p className="px-4 py-10 text-center text-sm text-muted">Nothing needs attention right now.</p> : <ul>{need.map((n) => <li key={n.text}><Link href={n.href} className="flex items-center gap-3 border-b border-border px-4 py-3 text-sm transition last:border-0 hover:bg-hover/60"><span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${tone[n.tone]}`}><Icon name={n.icon} className="h-4 w-4" /></span><span className="min-w-0 flex-1"><span className="block"><strong className={n.tone === "danger" ? "text-brand" : ""}>{n.n}</strong> {n.text}</span>{n.sub && <span className="block truncate text-xs text-muted">{n.sub}</span>}</span><Icon name="chevron" className="h-4 w-4 text-muted" /></Link></li>)}</ul>}
          </section>
        </div>
        <DashboardGrid key={`${layout.order.join(",")}|${layout.hidden.join(",")}`} widgets={widgets} order={layout.order} hidden={layout.hidden} />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-primary to-[#2f2590] p-6 text-white shadow-lg md:p-8">
        <span aria-hidden className="pointer-events-none absolute -right-16 -top-16 h-72 w-72 rounded-full bg-white/10" />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div><p className="text-sm text-white/80">{date} · {user.roles[0] ?? "Staff"}</p><h1 className="mt-1 text-3xl font-semibold tracking-tight">{hello}, {user.name.split(" ")[0]}</h1>
            <p className="mt-1 text-sm text-white/85">{att.total === 0 ? "Nothing needs your attention today." : `${att.total} thing${att.total === 1 ? "" : "s"} need${att.total === 1 ? "s" : ""} your attention today${att.urgent ? `, ${att.urgent} urgent` : ""}.`}</p></div>
          <PeriodSelect value={period} light />
        </div>
        <div className="relative mt-6 grid gap-3 sm:grid-cols-3">
          {canFinance && <div className="rounded-2xl border border-white/20 bg-white/10 p-4 backdrop-blur"><p className="text-[11px] font-semibold uppercase tracking-wider text-white/70">Collected</p><p className="mt-1 text-2xl font-semibold tabular-nums">{hero.collected.length ? hero.collected.slice(0, 2).map((m) => `${m.currency} ${Math.round(Number(m.amount)).toLocaleString()}`).join(" · ") : "0"}</p><p className="text-xs text-white/70">{PERIODS[period].toLowerCase()}</p></div>}
          {canFinance && <div className="rounded-2xl border border-white/20 bg-white/10 p-4 backdrop-blur"><p className="text-[11px] font-semibold uppercase tracking-wider text-white/70">Overdue</p><p className="mt-1 text-2xl font-semibold tabular-nums">{hero.overdue.count}</p><p className="truncate text-xs text-white/70">{hero.overdue.amounts.length ? money(hero.overdue.amounts) : "nothing overdue"}</p></div>}
          {canLeads && <div className="rounded-2xl border border-white/20 bg-white/10 p-4 backdrop-blur"><p className="text-[11px] font-semibold uppercase tracking-wider text-white/70">New leads</p><p className="mt-1 text-2xl font-semibold tabular-nums">{hero.leads.fresh}</p><p className="text-xs text-white/70">{hero.leads.total} in total</p></div>}
        </div>
      </section>

      <nav aria-label="Quick actions" className="flex flex-wrap gap-2">
        {actions.filter((a) => a[3]).map(([label, to, icon]) => <Link key={label} href={to} className="inline-flex items-center gap-2 rounded-full border border-border bg-surface py-1.5 pl-2 pr-4 text-sm font-medium shadow-sm transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-primary"><Icon name={icon} className="h-3.5 w-3.5" /></span>{label}</Link>)}
      </nav>

      <nav aria-label="Dashboard sections" className="flex gap-1.5 overflow-x-auto rounded-2xl border border-border bg-surface p-1.5">
        {visibleTabs.map(([k, label, icon]) => <Link key={k} href={href({ tab: k === "overview" ? undefined : k, cur: undefined })} aria-current={tab === k ? "page" : undefined} className={`inline-flex items-center gap-2 whitespace-nowrap rounded-xl px-3.5 py-2 text-sm font-medium transition ${tab === k ? "bg-primary text-white shadow" : "text-muted hover:bg-hover hover:text-foreground"}`}><Icon name={icon} className="h-4 w-4" />{label}</Link>)}
      </nav>
      {body}
    </div>
  );
}
