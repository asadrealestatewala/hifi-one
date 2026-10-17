// Every downloadable report as plain tables, built from the same loaders the screens use, so a download always
// matches what is on screen. One table model feeds both CSV and PDF. Free of Next.js imports (testable).
import type { Prisma, PrismaClient } from "@prisma/client";
import { tableCsv } from "./crm-contacts";
import { loadLeadsReport } from "./leads-report";
import { summarize } from "./monitoring";
import { AGING_BUCKETS, buildBalanceSheet, buildIncomeStatement, groupByCurrency, loadBalances, loadCashMovement, loadPayablesAging, loadReceivablesAging, type Line } from "./statements";
import { performance } from "./campaign-performance";
import { projectProgress } from "./project-rules";
import { salesTaxReport } from "./tax";

export type ReportColumn = { label: string; align?: "left" | "right" };
export type ReportSection = { heading: string; columns: ReportColumn[]; rows: string[][]; totals?: string[] };
export type ReportTable = { title: string; subtitle: string; sections: ReportSection[]; notes: string[] };

// Which permission each report needs. The download route checks it before building anything.
export const REPORTS = {
  pl: { title: "Profit and Loss", permission: "reports.view" },
  bs: { title: "Balance Sheet", permission: "reports.view" },
  cash: { title: "Cash and Bank Movement", permission: "reports.view" },
  aging: { title: "Receivables Aging", permission: "reports.view" },
  ap: { title: "Payables Aging", permission: "reports.view" },
  tax: { title: "Sales Tax", permission: "reports.view" },
  leads: { title: "Leads Report", permission: "crm.view" },
  workforce: { title: "Workforce Time and Activity", permission: "monitoring.view_team" },
  campaign: { title: "Campaign Performance", permission: "campaigns.view" },
  campaign_client: { title: "Campaign Report for the Client", permission: "campaigns.view" },
} as const;
export type ReportKey = keyof typeof REPORTS;
export const isReportKey = (k: string | null | undefined): k is ReportKey => !!k && k in REPORTS;

const n2 = (v: { toString(): string } | number) => Number(v.toString()).toFixed(2);
const money = [{ label: "Code" }, { label: "Account" }, { label: "Amount", align: "right" as const }];
const lines = (ls: Line[]) => ls.map((l) => [l.code, l.name, n2(l.amount)]);

export type ReportParams = { organizationId: string; from: string; to: string; leadWhere?: Prisma.LeadWhereInput; departmentId?: string; campaignId?: string };

export async function buildReport(db: PrismaClient, key: ReportKey, p: ReportParams): Promise<ReportTable> {
  const period = `${p.from} to ${p.to}`;
  const r: ReportTable = { title: REPORTS[key].title, subtitle: period, sections: [], notes: [] };
  if (key === "pl" || key === "bs") {
    const rows = key === "pl" ? await loadBalances(db, p.organizationId, { from: p.from, to: p.to }) : await loadBalances(db, p.organizationId, { to: p.to });
    if (key === "bs") r.subtitle = `As at ${p.to}`;
    for (const [cur, cr] of groupByCurrency(rows)) {
      if (key === "pl") {
        const s = buildIncomeStatement(cr);
        r.sections.push(
          { heading: `Revenue (${cur})`, columns: money, rows: lines(s.revenue), totals: ["", "Total revenue", n2(s.totals.revenue)] },
          { heading: `Direct costs (${cur})`, columns: money, rows: lines(s.direct), totals: ["", "Gross profit", n2(s.totals.grossProfit)] },
          { heading: `Operating expenses (${cur})`, columns: money, rows: lines(s.opex), totals: ["", "Operating profit", n2(s.totals.operatingProfit)] },
          { heading: `Other income and expenses (${cur})`, columns: money, rows: [...lines(s.otherIncome), ...lines(s.otherExpense).map((x) => [x[0], x[1], `-${x[2]}`])], totals: ["", "Net profit", n2(s.totals.netProfit)] },
        );
      } else {
        const b = buildBalanceSheet(cr);
        r.sections.push(
          { heading: `Assets (${cur})`, columns: money, rows: lines(b.assets), totals: ["", "Total assets", n2(b.totals.assets)] },
          { heading: `Liabilities (${cur})`, columns: money, rows: lines(b.liabilities), totals: ["", "Total liabilities", n2(b.totals.liabilities)] },
          { heading: `Equity (${cur})`, columns: money, rows: [...lines(b.equity), ["", "Earnings to date", n2(b.earnings)]], totals: ["", "Total liabilities and equity", n2(b.totals.liabilitiesAndEquity)] },
        );
        if (!b.balanced) r.notes.push(`${cur}: OUT OF BALANCE. Investigate before relying on this report.`);
      }
    }
    if (rows.length === 0) r.notes.push("No postings in this period.");
  } else if (key === "cash") {
    const moves = await loadCashMovement(db, p.organizationId, { from: p.from, to: p.to });
    r.sections.push({ heading: "Bank and cash accounts", columns: [{ label: "Account" }, { label: "Currency" }, { label: "Opening", align: "right" }, { label: "Money in", align: "right" }, { label: "Money out", align: "right" }, { label: "Closing", align: "right" }], rows: moves.map((m) => [m.name, m.currency, n2(m.opening), n2(m.inflow), n2(m.outflow), n2(m.closing)]) });
    r.notes.push("A full cash flow statement (operating, investing, financing) is not built yet.");
  } else if (key === "aging" || key === "ap") {
    const asOf = new Date();
    r.subtitle = `As at ${asOf.toISOString().slice(0, 10)}`;
    const a = key === "aging" ? await loadReceivablesAging(db, p.organizationId, asOf) : await loadPayablesAging(db, p.organizationId, asOf);
    for (const [cur, m] of a.byCurrency) {
      r.sections.push({ heading: `Summary (${cur})`, columns: [...AGING_BUCKETS.map((b) => ({ label: b, align: "right" as const })), { label: "Total", align: "right" }], rows: [[...AGING_BUCKETS.map((b) => n2(m.get(b) ?? 0)), n2([...m.values()].reduce((x, v) => x + Number(v), 0))]] });
    }
    if (key === "aging") {
      const d = (a as Awaited<ReturnType<typeof loadReceivablesAging>>).detail;
      r.sections.push({ heading: "Invoices", columns: [{ label: "Invoice" }, { label: "Client" }, { label: "Due" }, { label: "Age" }, { label: "Currency" }, { label: "Outstanding", align: "right" }], rows: d.map((x) => [x.number ?? "", x.client, x.dueDate?.toISOString().slice(0, 10) ?? "", x.bucket, x.currency, n2(x.outstanding)]) });
    } else {
      const d = (a as Awaited<ReturnType<typeof loadPayablesAging>>).detail;
      r.sections.push({ heading: "Vendor bills", columns: [{ label: "Bill" }, { label: "Vendor" }, { label: "Posted" }, { label: "Age" }, { label: "Currency" }, { label: "Amount", align: "right" }], rows: d.map((x) => [x.number, x.vendor, x.postedOn.toISOString().slice(0, 10), x.bucket, x.currency, n2(x.amount)]) });
      r.notes.push("Age runs from the day the bill was posted, because vendor bills do not have due dates yet.");
    }
  } else if (key === "tax") {
    for (const t of await salesTaxReport(db, p.organizationId, { from: p.from, to: p.to })) {
      r.sections.push({ heading: `Sales tax (${t.currency})`, columns: [{ label: "Rate %" }, { label: "Invoices", align: "right" }, { label: "Taxable sales", align: "right" }, { label: "Tax charged", align: "right" }], rows: t.lines.map((l) => [String(l.rate), String(l.count), n2(l.taxable), n2(l.tax)]), totals: ["Net tax", "", `less ${n2(t.reversed)} credited`, n2(t.net)] });
    }
    r.notes.push("Tax charged on invoices issued in the period; tax paid on purchases is not tracked yet.");
  } else if (key === "leads") {
    const l = await loadLeadsReport(db, p.organizationId, p.leadWhere ?? { organizationId: p.organizationId }, { from: p.from, to: p.to });
    const owners = new Map((await db.user.findMany({ where: { id: { in: l.byOwner.map((o) => o.id).filter(Boolean) as string[] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
    r.sections.push(
      { heading: "Summary", columns: [{ label: "Measure" }, { label: "Value", align: "right" }], rows: [["New leads in period", String(l.created)], ["Won in period", String(l.won)], ["Lost in period", String(l.lost)], ["Open now", String(l.open)], ["Conversion of decided leads", l.conversion === null ? "n/a" : `${l.conversion}%`], ["All leads in view", String(l.total)]] },
      { heading: "Pipeline by stage", columns: [{ label: "Stage" }, { label: "Leads", align: "right" }, { label: "Value" }], rows: l.funnel.map((f) => [f.name, String(f.count), f.money.map((m) => `${m.value} ${m.currency}`).join("; ")]) },
      { heading: "Sources (new leads)", columns: [{ label: "Source" }, { label: "Leads", align: "right" }, { label: "Won", align: "right" }], rows: l.bySource.map((s) => [s.source, String(s.leads), String(s.won)]) },
      { heading: "Owners (new leads)", columns: [{ label: "Owner" }, { label: "Leads", align: "right" }, { label: "Won", align: "right" }], rows: l.byOwner.map((o) => [o.id ? owners.get(o.id) ?? "Unknown" : "Unassigned", String(o.leads), String(o.won)]) },
      { heading: "New leads per week", columns: [{ label: "Week starting" }, { label: "Leads", align: "right" }], rows: l.weeks.map((w) => [w.start, String(w.count)]) },
    );
  } else if (key === "workforce") {
    const people = await db.user.findMany({ where: { organizationId: p.organizationId, userType: "EMPLOYEE", active: true, ...(p.departmentId ? { departmentId: p.departmentId } : {}) }, select: { id: true, name: true, department: { select: { name: true } } }, orderBy: { name: "asc" } });
    const rows = await summarize(db, { organizationId: p.organizationId, userIds: people.map((x) => x.id), from: p.from, to: p.to });
    const by = new Map(rows.map((x) => [x.userId, x]));
    r.sections.push({
      heading: "Per person", columns: [{ label: "Person" }, { label: "Department" }, { label: "Attendance min", align: "right" }, { label: "Break min", align: "right" }, { label: "Active min", align: "right" }, { label: "Idle min", align: "right" }, { label: "Screenshots", align: "right" }, { label: "Corrections min", align: "right" }],
      rows: people.map((x) => { const s = by.get(x.id); return [x.name, x.department?.name ?? "", String(s?.attendanceMinutes ?? 0), String(s?.breakMinutes ?? 0), String(s?.activeMinutes ?? 0), String(s?.idleMinutes ?? 0), String(s?.screenshots ?? 0), String(s?.correctedMinutes ?? 0)]; }),
    });
    r.notes.push("Figures are context, not a verdict. Only people who accepted the monitoring policy are recorded.");
  }
  else if (key === "campaign" || key === "campaign_client") {
    const c = p.campaignId ? await db.campaign.findFirst({ where: { id: p.campaignId, organizationId: p.organizationId }, include: { category: { select: { name: true } } } }) : null;
    if (!c) { r.notes.push("Campaign not found."); return r; }
    r.title = `${key === "campaign" ? "Campaign performance" : "Campaign report"}: ${c.name}`;
    const perf = await performance(db, p.organizationId, c.id, { from: p.from, to: p.to });
    const fig = (f: { currency: string; amount: number }[]) => f.map((x) => `${n2(x.amount)} ${x.currency}`).join("; ") || "none";
    const projects = await db.project.findMany({ where: { organizationId: p.organizationId, campaignId: c.id }, select: { id: true, number: true, name: true, status: true, tasks: { select: { status: true, completedAt: true, parentId: true } } }, orderBy: { number: "asc" } });
    const deliverables = await db.deliverable.findMany({ where: { organizationId: p.organizationId, campaignId: c.id, status: { not: "DRAFT" } }, orderBy: { createdAt: "desc" }, take: 30 });
    const start = new Date(`${p.from}T00:00:00.000Z`), end = new Date(`${p.to}T23:59:59.999Z`);
    const doneInPeriod = projects.reduce((n, pr) => n + pr.tasks.filter((t) => t.completedAt && t.completedAt >= start && t.completedAt <= end).length, 0);
    const overview: string[][] = [["Campaign", `${c.name}${c.code ? ` (${c.code})` : ""}`], ["Category", c.category?.name ?? "Not set"], ["Status", c.status.toLowerCase()], ["Period", `${p.from} to ${p.to}`], ["Leads generated", String(perf.leads)], ["Leads won", String(perf.won)], ["Conversion", perf.conversion === null ? "n/a" : `${perf.conversion}%`], ["Tasks completed in the period", String(doneInPeriod)]];
    if (key === "campaign") overview.push(["Spend entered", fig(perf.spend)], ["Won deal value", fig(perf.wonValue)], ["Cost per lead", fig(perf.costPerLead)], ["Cost per won lead", fig(perf.costPerWon)], ["Return on spend", perf.roi.map((x) => `${x.percent}% (${x.currency})`).join("; ") || "n/a"], ["Impressions", String(perf.impressions)], ["Clicks", String(perf.clicks)], ["Click-through rate", perf.ctr === null ? "n/a" : `${perf.ctr}%`], ["Results reported", String(perf.results)]);
    r.sections.push({ heading: "Summary", columns: [{ label: "Measure" }, { label: "Value", align: "right" }], rows: overview });
    if (c.description) r.sections.push({ heading: "About", columns: [{ label: "Description" }], rows: [[c.description], ...(c.objectives ? [[`Objectives: ${c.objectives}`]] : [])] });
    if (key === "campaign") {
      r.sections.push({ heading: "Spend by platform", columns: [{ label: "Platform" }, { label: "Currency" }, { label: "Spend", align: "right" }, { label: "Impressions", align: "right" }, { label: "Clicks", align: "right" }, { label: "Results", align: "right" }], rows: perf.byPlatform.map((b) => [b.platform, b.currency, n2(b.amount), String(b.impressions), String(b.clicks), String(b.results)]) });
      const entries = await db.campaignSpend.findMany({ where: { organizationId: p.organizationId, campaignId: c.id, date: { gte: p.from, lte: p.to } }, orderBy: { date: "asc" } });
      r.sections.push({ heading: "Spend entries", columns: [{ label: "Date" }, { label: "Platform" }, { label: "Amount", align: "right" }, { label: "Currency" }, { label: "Note" }], rows: entries.map((e) => [e.date, e.platform, n2(e.amount), e.currency, e.note ?? ""]) });
      r.notes.push("Spend, impressions, clicks and results are entered by hand; no advertising account is connected. Leads and wins come from the CRM.");
    }
    r.sections.push({ heading: "Projects", columns: [{ label: "Project" }, { label: "Status" }, { label: "Progress", align: "right" }, { label: "Open tasks", align: "right" }], rows: projects.map((pr) => [`${pr.number} ${pr.name}`, pr.status.toLowerCase(), `${projectProgress(pr.tasks)}%`, String(pr.tasks.filter((t) => !t.parentId && t.status !== "DONE").length)]) });
    r.sections.push({ heading: "Deliverables", columns: [{ label: "Deliverable" }, { label: "Version", align: "right" }, { label: "Status" }, { label: "Decided" }], rows: deliverables.map((d) => [d.title, String(d.version), d.status.toLowerCase().replace(/_/g, " "), d.decidedAt?.toISOString().slice(0, 10) ?? ""]) });
  }
  return r;
}

// CSV: one block per section, a blank line between them. Numbers stay plain so spreadsheets can sum them.
export function reportCsv(r: ReportTable): string {
  const parts = [tableCsv([r.title], [[r.subtitle]])];
  for (const s of r.sections) parts.push(tableCsv([s.heading], []) + tableCsv(s.columns.map((c) => c.label), [...s.rows, ...(s.totals ? [s.totals] : [])]));
  if (r.notes.length) parts.push(tableCsv(["Notes"], r.notes.map((n) => [n])));
  return parts.join("\r\n");
}
