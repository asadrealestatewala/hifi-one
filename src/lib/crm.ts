// CRM depth: lead scoring, smart lists (saved filters), sales activity logging with verified connected calls, targets, campaigns.
// Rules that matter:
//  - A call that was only attempted is never counted as connected. A "connected" call counts toward targets only after a
//    different person (a manager) has verified it, because nothing here proves a call connected unless telephony is integrated.
//  - Smart lists use the same record-level scope as the Leads screen, so a saved or shared list can never show someone a lead they cannot open.
import type { Prisma, PrismaClient } from "@prisma/client";
import { dec } from "./ledger-math";
import { CURRENCIES } from "./money";

export class CrmError extends Error {}
type Db = PrismaClient;

// ---------- lead score ----------
export type ScoreInput = {
  email?: string | null; phone?: string | null; company?: string | null; serviceInterest?: string | null; dealValue?: { toString(): string } | null;
  expectedCloseDate?: string | null; lastContactAt?: Date | null; createdAt: Date; stage: { probability: number; isWon: boolean; isLost: boolean }; clientId?: string | null;
};

// A transparent rule-based score (0 to 100) with the reasons shown, not a hidden model. It ranks follow-up order; it does not judge a person.
export function leadScore(l: ScoreInput, now = new Date()): { score: number; reasons: string[] } {
  if (l.stage.isLost) return { score: 0, reasons: ["Lost or not interested"] };
  if (l.stage.isWon || l.clientId) return { score: 100, reasons: ["Won"] };
  const reasons: string[] = [];
  let s = 0;
  const add = (n: number, why: string) => { s += n; reasons.push(`${n > 0 ? "+" : ""}${n} ${why}`); };
  if (l.email) add(10, "has an email address");
  if (l.phone) add(10, "has a phone number");
  if (l.company) add(5, "company known");
  if (l.serviceInterest) add(5, "service of interest recorded");
  const stagePts = Math.round(l.stage.probability * 0.3);
  if (stagePts > 0) add(stagePts, `pipeline stage (${l.stage.probability}% likely)`);
  if (l.dealValue && dec(l.dealValue.toString()).gt(0)) add(10, "has an expected deal value");
  if (l.expectedCloseDate) {
    const days = (Date.parse(l.expectedCloseDate) - now.getTime()) / 86400000;
    if (days >= -1 && days <= 30) add(10, "expected to close within 30 days");
  }
  const last = l.lastContactAt ?? l.createdAt;
  const idle = (now.getTime() - last.getTime()) / 86400000;
  if (idle <= 7) add(15, "contacted in the last 7 days");
  else if (idle > 21) add(-15, `no contact for ${Math.floor(idle)} days`);
  return { score: Math.max(0, Math.min(100, s)), reasons };
}

// ---------- smart lists ----------
export type LeadFilters = {
  q?: string; stageNames?: string[]; source?: string; campaignId?: string; assignedTo?: "me" | "unassigned" | string; tag?: string; priority?: string;
  minValue?: number; followUp?: "today" | "overdue" | "none"; noContactDays?: number; openOnly?: boolean;
};

export const SYSTEM_LISTS: { id: string; name: string; description: string; filters: LeadFilters }[] = [
  { id: "follow-up-today", name: "Follow-up due today", description: "Open leads whose next follow-up is today or earlier", filters: { followUp: "overdue", openOnly: true } },
  { id: "interested-quiet", name: "Interested, not contacted for 7 days", description: "Interested prospects with no recent contact", filters: { stageNames: ["Interested"], noContactDays: 7, openOnly: true } },
  { id: "proposals", name: "Proposals awaiting a decision", description: "Proposal sent or in negotiation", filters: { stageNames: ["Proposal Sent", "Negotiation"], openOnly: true } },
  { id: "inactive-7", name: "Inactive for 7 days", description: "Open leads with no contact for a week", filters: { noContactDays: 7, openOnly: true } },
  { id: "mine", name: "Assigned to me", description: "Open leads you own", filters: { assignedTo: "me", openOnly: true } },
  { id: "unassigned", name: "Unassigned", description: "Open leads nobody owns yet", filters: { assignedTo: "unassigned", openOnly: true } },
  { id: "high-value", name: "High value", description: "Open leads worth 10,000 or more", filters: { minValue: 10000, openOnly: true } },
  { id: "nurture", name: "Nurture / future opportunity", description: "Leads parked for later", filters: { stageNames: ["Nurture"] } },
];

export function cleanFilters(raw: unknown): LeadFilters {
  const r = (raw ?? {}) as Record<string, unknown>;
  const f: LeadFilters = {};
  const str = (k: string, max = 120) => (typeof r[k] === "string" && (r[k] as string).trim() ? (r[k] as string).trim().slice(0, max) : undefined);
  const q = str("q", 80); if (q) f.q = q;
  const source = str("source"); if (source) f.source = source;
  const campaignId = str("campaignId", 40); if (campaignId) f.campaignId = campaignId;
  const assignedTo = str("assignedTo", 40); if (assignedTo) f.assignedTo = assignedTo;
  const tag = str("tag", 40); if (tag) f.tag = tag;
  const priority = str("priority", 10); if (priority && ["LOW", "MEDIUM", "HIGH"].includes(priority)) f.priority = priority;
  if (Array.isArray(r.stageNames)) f.stageNames = r.stageNames.filter((x): x is string => typeof x === "string").slice(0, 12);
  const mv = Number(r.minValue); if (Number.isFinite(mv) && mv > 0) f.minValue = mv;
  const nc = Number(r.noContactDays); if (Number.isInteger(nc) && nc >= 1 && nc <= 365) f.noContactDays = nc;
  if (r.followUp === "today" || r.followUp === "overdue" || r.followUp === "none") f.followUp = r.followUp;
  if (r.openOnly === true) f.openOnly = true;
  return f;
}

export function buildLeadWhere(f: LeadFilters, ctx: { userId: string; scope: Prisma.LeadWhereInput; now?: Date }): Prisma.LeadWhereInput {
  const now = ctx.now ?? new Date();
  const and: Prisma.LeadWhereInput[] = [ctx.scope];
  if (f.q) and.push({ OR: [{ name: { contains: f.q.replace(/[\\%_]/g, (c) => "\\" + c), mode: "insensitive" } }, { company: { contains: f.q.replace(/[\\%_]/g, (c) => "\\" + c), mode: "insensitive" } }, { email: { contains: f.q.replace(/[\\%_]/g, (c) => "\\" + c), mode: "insensitive" } }, { phone: { contains: f.q } }] });
  if (f.stageNames?.length) and.push({ stage: { name: { in: f.stageNames } } });
  if (f.openOnly) and.push({ clientId: null, stage: { isWon: false, isLost: false } });
  if (f.source) and.push({ source: f.source });
  if (f.campaignId) and.push({ campaignId: f.campaignId });
  if (f.assignedTo === "me") and.push({ assignedToId: ctx.userId });
  else if (f.assignedTo === "unassigned") and.push({ assignedToId: null });
  else if (f.assignedTo) and.push({ assignedToId: f.assignedTo });
  if (f.tag) and.push({ tags: { has: f.tag } });
  if (f.priority) and.push({ priority: f.priority });
  if (f.minValue) and.push({ dealValue: { gte: f.minValue } });
  if (f.followUp === "today") { const end = new Date(now); end.setUTCHours(23, 59, 59, 999); const start = new Date(now); start.setUTCHours(0, 0, 0, 0); and.push({ nextFollowUp: { gte: start, lte: end } }); }
  if (f.followUp === "overdue") { const end = new Date(now); end.setUTCHours(23, 59, 59, 999); and.push({ nextFollowUp: { lte: end } }); }
  if (f.followUp === "none") and.push({ nextFollowUp: null });
  if (f.noContactDays) { const cut = new Date(now.getTime() - f.noContactDays * 86400000); and.push({ OR: [{ lastContactAt: { lt: cut } }, { lastContactAt: null, createdAt: { lt: cut } }] }); }
  return { AND: and };
}

export async function saveSmartList(db: Db, p: { organizationId: string; ownerId: string; name: string; filters: unknown; shared: boolean }) {
  const name = p.name.trim();
  if (!name || name.length > 80) throw new CrmError("Give the list a name of up to 80 characters.");
  const filters = cleanFilters(p.filters);
  if (Object.keys(filters).length === 0) throw new CrmError("Choose at least one filter before saving.");
  try {
    return await db.smartList.create({ data: { organizationId: p.organizationId, ownerId: p.ownerId, name, filters: filters as Prisma.InputJsonValue, shared: p.shared } });
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") throw new CrmError("You already have a list with that name.");
    throw e;
  }
}

export async function deleteSmartList(db: Db, p: { organizationId: string; ownerId: string; id: string }) {
  const r = await db.smartList.deleteMany({ where: { id: p.id, organizationId: p.organizationId, ownerId: p.ownerId } });
  if (r.count === 0) throw new CrmError("List not found, or it belongs to someone else.");
}

export const visibleLists = (db: Db, organizationId: string, userId: string) =>
  db.smartList.findMany({ where: { organizationId, OR: [{ ownerId: userId }, { shared: true }] }, orderBy: { name: "asc" } });

// ---------- activities ----------
export const ACTIVITY_KINDS = ["CALL", "EMAIL", "MEETING", "FOLLOW_UP", "PROPOSAL", "APPOINTMENT", "WHATSAPP", "NOTE"] as const;
export const CALL_OUTCOMES = ["NO_ANSWER", "VOICEMAIL", "CONNECTED", "WRONG_NUMBER", "NOT_INTERESTED"] as const;
const CONTACT_MADE = new Set(["EMAIL", "MEETING", "WHATSAPP", "APPOINTMENT"]);

export async function logActivity(db: Db, p: { organizationId: string; leadId: string; actorId: string; kind: string; outcome?: string; body?: string; nextFollowUp?: string | null }) {
  if (!(ACTIVITY_KINDS as readonly string[]).includes(p.kind)) throw new CrmError("Choose what kind of activity this was.");
  if (p.kind === "CALL" && !(CALL_OUTCOMES as readonly string[]).includes(p.outcome ?? "")) throw new CrmError("Say how the call went.");
  if (p.kind !== "CALL" && p.outcome) throw new CrmError("Only calls have an outcome.");
  if ((p.body ?? "").length > 2000) throw new CrmError("The note is too long.");
  if (p.nextFollowUp && Number.isNaN(Date.parse(p.nextFollowUp))) throw new CrmError("Enter a valid follow-up date.");
  const lead = await db.lead.findFirst({ where: { id: p.leadId, organizationId: p.organizationId } });
  if (!lead) throw new CrmError("Lead not found.");
  const contacted = CONTACT_MADE.has(p.kind) || (p.kind === "CALL" && p.outcome === "CONNECTED");
  return db.$transaction(async (tx) => {
    const a = await tx.leadActivity.create({ data: { leadId: lead.id, actorId: p.actorId, kind: p.kind, outcome: p.outcome ?? null, body: p.body?.trim() || null } });
    await tx.lead.update({ where: { id: lead.id }, data: { ...(contacted ? { lastContactAt: new Date() } : {}), ...(p.nextFollowUp ? { nextFollowUp: new Date(p.nextFollowUp) } : {}) } });
    return a;
  });
}

// A different person confirms a claimed connected call. Nobody verifies their own.
export async function verifyActivity(db: Db, p: { organizationId: string; activityId: string; verifierId: string }) {
  const a = await db.leadActivity.findFirst({ where: { id: p.activityId, lead: { organizationId: p.organizationId } } });
  if (!a) throw new CrmError("Activity not found.");
  if (a.kind !== "CALL" || a.outcome !== "CONNECTED") throw new CrmError("Only connected calls need verifying.");
  if (a.actorId === p.verifierId) throw new CrmError("You cannot verify your own call. Ask a manager.");
  const r = await db.leadActivity.updateMany({ where: { id: a.id, verified: false }, data: { verified: true, verifiedById: p.verifierId } });
  if (r.count === 0) throw new CrmError("This call has already been verified.");
}

// ---------- targets and daily dashboard ----------
export const METRICS = ["CALLS", "CONNECTED_CALLS", "EMAILS", "MEETINGS", "FOLLOW_UPS", "PROPOSALS", "CONVERSIONS"] as const;
export type Metric = (typeof METRICS)[number];

export async function setTarget(db: Db, p: { organizationId: string; userId: string; metric: string; daily?: number | null; monthly?: number | null; actorId: string }) {
  if (!(METRICS as readonly string[]).includes(p.metric)) throw new CrmError("Choose an activity type.");
  for (const v of [p.daily, p.monthly]) if (v != null && (!Number.isInteger(v) || v < 0 || v > 100000)) throw new CrmError("Targets are whole numbers from 0 up.");
  if (!(await db.user.findFirst({ where: { id: p.userId, organizationId: p.organizationId, userType: "EMPLOYEE", active: true } }))) throw new CrmError("Choose an active staff member.");
  if (p.daily == null && p.monthly == null) {
    await db.salesTarget.deleteMany({ where: { organizationId: p.organizationId, userId: p.userId, metric: p.metric } });
    return null;
  }
  return db.salesTarget.upsert({
    where: { organizationId_userId_metric: { organizationId: p.organizationId, userId: p.userId, metric: p.metric } },
    update: { daily: p.daily ?? null, monthly: p.monthly ?? null, updatedById: p.actorId },
    create: { organizationId: p.organizationId, userId: p.userId, metric: p.metric, daily: p.daily ?? null, monthly: p.monthly ?? null, updatedById: p.actorId },
  });
}

type Counts = Record<Metric, number> & { connectedPending: number };
const zero = (): Counts => ({ CALLS: 0, CONNECTED_CALLS: 0, EMAILS: 0, MEETINGS: 0, FOLLOW_UPS: 0, PROPOSALS: 0, CONVERSIONS: 0, connectedPending: 0 });

async function countFor(db: Db, organizationId: string, from: Date, to: Date): Promise<Map<string, Counts>> {
  const [acts, conv] = await Promise.all([
    db.leadActivity.findMany({ where: { createdAt: { gte: from, lte: to }, actorId: { not: null }, lead: { organizationId }, kind: { in: ["CALL", "EMAIL", "MEETING", "APPOINTMENT", "FOLLOW_UP", "PROPOSAL"] } }, select: { actorId: true, kind: true, outcome: true, verified: true } }),
    db.lead.findMany({ where: { organizationId, convertedAt: { gte: from, lte: to }, assignedToId: { not: null } }, select: { assignedToId: true } }),
  ]);
  const m = new Map<string, Counts>();
  const get = (id: string) => { let c = m.get(id); if (!c) { c = zero(); m.set(id, c); } return c; };
  for (const a of acts) {
    const c = get(a.actorId!);
    if (a.kind === "CALL") { c.CALLS++; if (a.outcome === "CONNECTED") { if (a.verified) c.CONNECTED_CALLS++; else c.connectedPending++; } }
    else if (a.kind === "EMAIL") c.EMAILS++;
    else if (a.kind === "MEETING" || a.kind === "APPOINTMENT") c.MEETINGS++;
    else if (a.kind === "FOLLOW_UP") c.FOLLOW_UPS++;
    else if (a.kind === "PROPOSAL") c.PROPOSALS++;
  }
  for (const l of conv) get(l.assignedToId!).CONVERSIONS++;
  return m;
}

export async function salesDashboard(db: Db, p: { organizationId: string; userIds: string[] | null; now?: Date }) {
  const now = p.now ?? new Date();
  const dayStart = new Date(now); dayStart.setUTCHours(0, 0, 0, 0);
  const dayEnd = new Date(now); dayEnd.setUTCHours(23, 59, 59, 999);
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [today, month, targets, users, open, overdue, last30] = await Promise.all([
    countFor(db, p.organizationId, dayStart, dayEnd),
    countFor(db, p.organizationId, monthStart, dayEnd),
    db.salesTarget.findMany({ where: { organizationId: p.organizationId, ...(p.userIds ? { userId: { in: p.userIds } } : {}) } }),
    db.user.findMany({ where: { organizationId: p.organizationId, userType: "EMPLOYEE", active: true, ...(p.userIds ? { id: { in: p.userIds } } : {}) }, select: { id: true, name: true } }),
    db.lead.groupBy({ by: ["assignedToId", "currency"], where: { organizationId: p.organizationId, clientId: null, stage: { isWon: false, isLost: false } }, _sum: { dealValue: true }, _count: true }),
    db.lead.groupBy({ by: ["assignedToId"], where: { organizationId: p.organizationId, clientId: null, stage: { isWon: false, isLost: false }, nextFollowUp: { lt: dayStart } }, _count: true }),
    db.lead.findMany({ where: { organizationId: p.organizationId, createdAt: { gte: new Date(now.getTime() - 30 * 86400000) } }, select: { assignedToId: true, convertedAt: true } }),
  ]);
  const rows = users.map((u) => {
    const t = today.get(u.id) ?? zero();
    const mo = month.get(u.id) ?? zero();
    const tg = (metric: Metric) => targets.find((x) => x.userId === u.id && x.metric === metric);
    const mine = last30.filter((l) => l.assignedToId === u.id);
    return {
      userId: u.id, name: u.name, today: t, month: mo,
      targets: Object.fromEntries(METRICS.map((mt) => [mt, { daily: tg(mt)?.daily ?? null, monthly: tg(mt)?.monthly ?? null }])) as Record<Metric, { daily: number | null; monthly: number | null }>,
      overdueFollowUps: overdue.find((o) => o.assignedToId === u.id)?._count ?? 0,
      pipeline: open.filter((o) => o.assignedToId === u.id).map((o) => ({ currency: o.currency, value: o._sum.dealValue?.toString() ?? "0", count: o._count })),
      conversionRate30d: mine.length ? Math.round((mine.filter((l) => l.convertedAt).length / mine.length) * 100) : null,
    };
  });
  rows.sort((a, b) => b.today.CONNECTED_CALLS - a.today.CONNECTED_CALLS || b.month.CONVERSIONS - a.month.CONVERSIONS || b.today.CALLS - a.today.CALLS);
  return rows;
}

// ---------- campaigns ----------
export const CHANNELS = ["FACEBOOK", "INSTAGRAM", "LINKEDIN", "GOOGLE", "EMAIL", "REFERRAL", "COLD_CALLING", "EVENT", "OTHER"] as const;
export const CAMPAIGN_STATUSES = ["PLANNED", "ACTIVE", "PAUSED", "DONE"] as const;

export async function saveCampaign(db: Db, p: { organizationId: string; id?: string; name: string; channel: string; status: string; budget?: string | null; currency: string; startDate?: string | null; endDate?: string | null; notes?: string | null; actorId: string }) {
  const name = p.name.trim();
  if (!name || name.length > 100) throw new CrmError("Give the campaign a name of up to 100 characters.");
  if (!(CHANNELS as readonly string[]).includes(p.channel)) throw new CrmError("Choose a channel.");
  if (!(CAMPAIGN_STATUSES as readonly string[]).includes(p.status)) throw new CrmError("Choose a status.");
  if (!(CURRENCIES as readonly string[]).includes(p.currency)) throw new CrmError("Choose a supported currency.");
  if (p.budget && (!/^\d{1,12}(\.\d{1,2})?$/.test(p.budget))) throw new CrmError("Enter the budget as a number, or leave it empty.");
  for (const d of [p.startDate, p.endDate]) if (d && Number.isNaN(Date.parse(d))) throw new CrmError("Enter valid dates.");
  if (p.startDate && p.endDate && p.endDate < p.startDate) throw new CrmError("The end date must be on or after the start date.");
  const data = { name, channel: p.channel, status: p.status, budget: p.budget || null, currency: p.currency, startDate: p.startDate || null, endDate: p.endDate || null, notes: p.notes?.trim().slice(0, 1000) || null };
  try {
    if (p.id) {
      const r = await db.campaign.updateMany({ where: { id: p.id, organizationId: p.organizationId }, data });
      if (r.count === 0) throw new CrmError("Campaign not found.");
      return p.id;
    }
    return (await db.campaign.create({ data: { ...data, organizationId: p.organizationId, createdById: p.actorId } })).id;
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") throw new CrmError("A campaign with that name already exists.");
    throw e;
  }
}

export async function campaignStats(db: Db, organizationId: string) {
  const [campaigns, leads] = await Promise.all([
    db.campaign.findMany({ where: { organizationId }, orderBy: [{ status: "asc" }, { name: "asc" }] }),
    db.lead.findMany({ where: { organizationId, campaignId: { not: null } }, select: { campaignId: true, clientId: true, dealValue: true, currency: true, stage: { select: { isWon: true } } } }),
  ]);
  return campaigns.map((c) => {
    const ls = leads.filter((l) => l.campaignId === c.id);
    const won = ls.filter((l) => l.clientId || l.stage.isWon);
    const wonValue = won.reduce((a, l) => (l.currency === c.currency ? a.add(l.dealValue?.toString() ?? 0) : a), dec(0));
    const cost = c.budget ? dec(c.budget.toString()) : null;
    return { campaign: c, leads: ls.length, won: won.length, wonValue, costPerLead: cost && ls.length ? cost.div(ls.length).toDecimalPlaces(2) : null, winRate: ls.length ? Math.round((won.length / ls.length) * 100) : null };
  });
}
