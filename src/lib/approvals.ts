// Everything waiting for a decision from the person reading, gathered in one place. This is a read only: each kind
// is still decided on the screen that owns it, by the service that owns it, so there is one writer per fact and no
// rule is duplicated here. A manager who may only decide for their own reports sees only their own reports' rows.
// Free of Next.js imports so it can be tested against the database.
import type { PrismaClient } from "@prisma/client";
import { formatMoney } from "./money";

type Db = PrismaClient;

export type ApprovalRow = { id: string; title: string; sub?: string; who?: string; since: Date; href: string };
export type ApprovalGroup = { key: string; label: string; what: string; icon: string; count: number; href: string; rows: ApprovalRow[] };

export type ApprovalUser = { id: string; organizationId: string; permissions: ReadonlySet<string> };

const ROWS = 4; // how many of each kind to show; the count is always exact

// Sorts the groups so the oldest thing waiting is at the top, then counts the lot.
export function summarise(groups: ApprovalGroup[]): { groups: ApprovalGroup[]; total: number; oldest: Date | null } {
  const live = groups.filter((g) => g.count > 0);
  const age = (g: ApprovalGroup) => g.rows[0]?.since.getTime() ?? Number.MAX_SAFE_INTEGER;
  live.sort((a, b) => age(a) - age(b));
  const oldest = live.length ? new Date(Math.min(...live.map(age))) : null;
  return { groups: live, total: live.reduce((s, g) => s + g.count, 0), oldest: oldest && oldest.getTime() === Number.MAX_SAFE_INTEGER ? null : oldest };
}

// How long something has been waiting, in words a person uses.
export function waitingFor(since: Date, now: Date): string {
  const days = Math.floor((now.getTime() - since.getTime()) / 86_400_000);
  if (days >= 1) return `waiting ${days} day${days === 1 ? "" : "s"}`;
  const hours = Math.floor((now.getTime() - since.getTime()) / 3_600_000);
  return hours >= 1 ? `waiting ${hours} hour${hours === 1 ? "" : "s"}` : "just now";
}

export async function pendingApprovals(db: Db, user: ApprovalUser): Promise<ApprovalGroup[]> {
  const has = (p: string) => user.permissions.has(p);
  const org = user.organizationId;
  const all = has("attendance.view_all"); // HR decides for everyone; a manager only for their own reports
  const reports = has("leave.approve") && !all ? (await db.user.findMany({ where: { organizationId: org, managerId: user.id }, select: { id: true } })).map((u) => u.id) : null;
  const staffFilter = reports ? { in: reports } : undefined;
  const names = new Map<string, string>();
  const groups: ApprovalGroup[] = [];

  const [leave, visits, requests, vouchers, commissions, conversions, onboarding, corrections, deliverables] = await Promise.all([
    has("leave.approve")
      ? db.leaveRequest.findMany({ where: { status: "PENDING", userId: { not: user.id, ...(staffFilter ? { in: reports! } : {}) }, leaveType: { organizationId: org } }, orderBy: { createdAt: "asc" }, select: { id: true, userId: true, startDate: true, endDate: true, days: true, createdAt: true, leaveType: { select: { name: true } } } })
      : [],
    has("attendance.view_all") || has("leave.approve")
      ? db.siteVisitRequest.findMany({ where: { organizationId: org, status: "PENDING", userId: { not: user.id, ...(staffFilter ? { in: reports! } : {}) } }, orderBy: { startDate: "asc" }, select: { id: true, userId: true, kind: true, startDate: true, endDate: true, createdAt: true } })
      : [],
    has("hr.manage")
      ? db.employeeRequest.findMany({ where: { organizationId: org, status: { in: ["SUBMITTED", "IN_REVIEW"] } }, orderBy: { createdAt: "asc" }, select: { id: true, userId: true, type: true, subject: true, createdAt: true } })
      : [],
    has("expenses.review") || has("expenses.approve")
      ? db.expenseVoucher.findMany({ where: { organizationId: org, status: { in: ["SUBMITTED", "UNDER_REVIEW"] } }, orderBy: { createdAt: "asc" }, select: { id: true, number: true, description: true, amount: true, currency: true, createdAt: true, submittedById: true } })
      : [],
    has("commissions.approve") || has("commissions.manage")
      ? db.commissionEntry.findMany({ where: { organizationId: org, status: "EARNED" }, orderBy: { createdAt: "asc" }, select: { id: true, userId: true, amount: true, currency: true, createdAt: true } })
      : [],
    has("crm.convert")
      ? db.leadConversionRequest.findMany({ where: { organizationId: org, status: "PENDING" }, orderBy: { createdAt: "asc" }, select: { id: true, leadId: true, requestedById: true, createdAt: true, lead: { select: { name: true } } } })
      : [],
    has("onboarding.approve")
      ? db.onboardingRequest.findMany({ where: { organizationId: org, status: "PENDING_APPROVAL" }, orderBy: { createdAt: "asc" }, select: { id: true, userId: true, createdAt: true } })
      : [],
    has("monitoring.view_team")
      ? db.timesheetCorrection.findMany({ where: { organizationId: org, status: "PENDING", userId: { not: user.id } }, orderBy: { createdAt: "asc" }, select: { id: true, userId: true, day: true, createdAt: true } })
      : [],
    has("projects.manage")
      ? db.deliverable.findMany({ where: { status: "PENDING", organizationId: org }, orderBy: { requestedAt: "asc" }, select: { id: true, title: true, projectId: true, requestedAt: true, createdAt: true } })
      : [],
  ]);

  const ids = new Set<string>([...leave.map((l) => l.userId), ...visits.map((v) => v.userId), ...requests.map((r) => r.userId), ...vouchers.map((v) => v.submittedById), ...commissions.map((c) => c.userId), ...onboarding.map((o) => o.userId), ...corrections.map((c) => c.userId), ...conversions.map((c) => c.requestedById)]);
  if (ids.size > 0) for (const u of await db.user.findMany({ where: { id: { in: [...ids] } }, select: { id: true, name: true } })) names.set(u.id, u.name);
  const who = (id: string) => names.get(id) ?? "Someone";

  const group = (key: string, label: string, what: string, icon: string, href: string, rows: ApprovalRow[]): void => {
    groups.push({ key, label, what, icon, href, count: rows.length, rows: rows.slice(0, ROWS) });
  };

  group("leave", "Leave requests", "Days off your people have asked for.", "calendar", "/hr/leave",
    leave.map((l) => ({ id: l.id, title: `${l.leaveType.name}, ${l.days} day${Number(l.days) === 1 ? "" : "s"}`, sub: `${l.startDate} to ${l.endDate}`, who: who(l.userId), since: l.createdAt, href: "/hr/leave" })));
  group("visits", "Off-site and field work", "Client visits, field work and days worked from home.", "truck", "/hr/visits",
    visits.map((v) => ({ id: v.id, title: v.kind.replace(/_/g, " ").toLowerCase(), sub: v.startDate === v.endDate ? v.startDate : `${v.startDate} to ${v.endDate}`, who: who(v.userId), since: v.createdAt, href: "/hr/visits" })));
  group("requests", "Employee requests", "Certificates, advances, equipment and anything else asked of HR.", "file", "/hr/requests",
    requests.map((r) => ({ id: r.id, title: r.subject, sub: r.type.replace(/_/g, " ").toLowerCase(), who: who(r.userId), since: r.createdAt, href: `/hr/requests?open=${r.id}` })));
  group("vouchers", "Expense vouchers", "Money people spent for work and want back.", "wallet", "/expenses",
    vouchers.map((v) => ({ id: v.id, title: v.description, sub: `${v.number} · ${formatMoney(v.amount.toString(), v.currency)}`, who: who(v.submittedById), since: v.createdAt, href: `/expenses/${v.id}` })));
  group("commissions", "Commissions", "Earned commission waiting to be approved for payment.", "wallet", "/finance/commissions",
    commissions.map((c) => ({ id: c.id, title: formatMoney(c.amount.toString(), c.currency), who: who(c.userId), since: c.createdAt, href: "/finance/commissions" })));
  group("conversions", "Leads to close as won", "An agent says a lead is won and needs your word.", "target", "/leads/approvals",
    conversions.map((c) => ({ id: c.id, title: c.lead.name, who: who(c.requestedById), since: c.createdAt, href: `/leads/approvals` })));
  group("onboarding", "New staff to approve", "People who finished onboarding and are waiting to be let in.", "users", "/hr/onboarding",
    onboarding.map((o) => ({ id: o.id, title: who(o.userId), since: o.createdAt, href: "/hr/onboarding" })));
  group("corrections", "Time corrections", "Someone says a recorded day is wrong.", "clock", "/hr/monitoring",
    corrections.map((c) => ({ id: c.id, title: `Day ${c.day}`, who: who(c.userId), since: c.createdAt, href: "/hr/monitoring" })));
  group("deliverables", "Client deliverables", "Work sent to a client for approval.", "folder", "/projects",
    deliverables.map((d) => ({ id: d.id, title: d.title, since: d.requestedAt ?? d.createdAt, href: `/projects/${d.projectId}` })));

  return groups;
}
