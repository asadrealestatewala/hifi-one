// Campaign management. A campaign is the canonical record for a marketing or product push: its category comes from
// the shared business category list (ServiceCategory, also used by the service catalog), its team are staff
// (CampaignMember), its clients are Client records (CampaignClient), and leads and projects point to it
// (Lead.campaignId, Project.campaignId). Nothing is copied, so every view counts the same rows once.
// Free of Next.js imports so it can be tested against the database.
import type { Prisma, PrismaClient } from "@prisma/client";
import { CAMPAIGN_STATUSES, CHANNELS } from "./crm";
import { CURRENCIES } from "./money";

export class CampaignError extends Error {}
type Db = PrismaClient;
type Tx = Prisma.TransactionClient;

export type CampaignInput = {
  name: string; categoryId?: string | null; description?: string | null; objectives?: string | null; status?: string; channel?: string;
  budget?: string | null; currency?: string; startDate?: string | null; endDate?: string | null; ownerId?: string | null; notes?: string | null;
};

const clean = (v: string | null | undefined, max: number) => { const t = (v ?? "").trim(); return t ? t.slice(0, max) : null; };

async function nextCode(tx: Tx, organizationId: string) {
  const seq = await tx.numberSequence.upsert({
    where: { organizationId_key: { organizationId, key: "CAMPAIGN" } },
    create: { organizationId, key: "CAMPAIGN", next: 2 },
    update: { next: { increment: 1 } },
  });
  return `CMP-${String(seq.next - 1).padStart(4, "0")}`;
}

// Gives every campaign made before codes existed its CMP number, oldest first. Safe to run repeatedly.
export async function ensureCampaignCodes(db: Db, organizationId: string) {
  const missing = await db.campaign.findMany({ where: { organizationId, code: null }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true } });
  for (const c of missing) {
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Campaign" WHERE id = ${c.id} FOR UPDATE`;
      const cur = await tx.campaign.findUniqueOrThrow({ where: { id: c.id }, select: { code: true } });
      if (!cur.code) await tx.campaign.update({ where: { id: c.id }, data: { code: await nextCode(tx, organizationId) } });
    });
  }
  return missing.length;
}

async function validate(db: Db | Tx, organizationId: string, i: CampaignInput) {
  const name = (i.name ?? "").trim();
  if (name.length < 2 || name.length > 100) throw new CampaignError("Give the campaign a name of 2 to 100 characters.");
  const status = i.status ?? "ACTIVE";
  if (!(CAMPAIGN_STATUSES as readonly string[]).includes(status)) throw new CampaignError("Choose a status.");
  const channel = i.channel ?? "OTHER";
  if (!(CHANNELS as readonly string[]).includes(channel)) throw new CampaignError("Choose a channel.");
  const currency = i.currency ?? "USD";
  if (!(CURRENCIES as readonly string[]).includes(currency)) throw new CampaignError("Choose a supported currency.");
  const budget = clean(i.budget, 20);
  if (budget && !/^\d{1,12}(\.\d{1,2})?$/.test(budget)) throw new CampaignError("Enter the budget as a number, or leave it empty.");
  for (const d of [i.startDate, i.endDate]) if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new CampaignError("Enter valid dates.");
  if (i.startDate && i.endDate && i.endDate < i.startDate) throw new CampaignError("The end date must be on or after the start date.");
  if (i.categoryId && !(await db.serviceCategory.findFirst({ where: { id: i.categoryId, organizationId } }))) throw new CampaignError("Unknown category.");
  if (i.ownerId && !(await db.user.findFirst({ where: { id: i.ownerId, organizationId, userType: "EMPLOYEE" } }))) throw new CampaignError("Choose a staff member as owner.");
  return {
    name, status, channel, currency, budget, startDate: i.startDate || null, endDate: i.endDate || null, categoryId: i.categoryId || null, ownerId: i.ownerId || null,
    description: clean(i.description, 2000), objectives: clean(i.objectives, 2000), notes: clean(i.notes, 500),
  };
}

export async function saveCampaignRecord(db: Db, p: { organizationId: string; actorId: string; id?: string; input: CampaignInput }) {
  const data = await validate(db, p.organizationId, p.input);
  // Names are unique regardless of capitals, so "Podvet" and "podvet" cannot both exist
  if (await db.campaign.findFirst({ where: { organizationId: p.organizationId, name: { equals: data.name, mode: "insensitive" }, ...(p.id ? { id: { not: p.id } } : {}) } })) throw new CampaignError("A campaign with that name already exists.");
  try {
    if (p.id) {
      const r = await db.campaign.updateMany({ where: { id: p.id, organizationId: p.organizationId }, data });
      if (r.count === 0) throw new CampaignError("Campaign not found.");
      return db.campaign.findUniqueOrThrow({ where: { id: p.id } });
    }
    return await db.$transaction(async (tx) => tx.campaign.create({ data: { ...data, organizationId: p.organizationId, createdById: p.actorId, code: await nextCode(tx, p.organizationId) } }));
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") throw new CampaignError("A campaign with that name already exists.");
    throw e;
  }
}

export async function setCampaignArchived(db: Db, p: { organizationId: string; id: string; archived: boolean }) {
  const r = await db.campaign.updateMany({ where: { id: p.id, organizationId: p.organizationId }, data: { archivedAt: p.archived ? new Date() : null } });
  if (r.count === 0) throw new CampaignError("Campaign not found.");
}

// The team is replaced as a whole. Only staff of the same organization; the owner is always on the team.
export async function setCampaignTeam(db: Db, p: { organizationId: string; id: string; userIds: string[] }) {
  const c = await db.campaign.findFirst({ where: { id: p.id, organizationId: p.organizationId } });
  if (!c) throw new CampaignError("Campaign not found.");
  const ids = [...new Set([...p.userIds.filter(Boolean), ...(c.ownerId ? [c.ownerId] : [])])];
  const staff = await db.user.findMany({ where: { id: { in: ids }, organizationId: p.organizationId, userType: "EMPLOYEE" }, select: { id: true } });
  if (staff.length !== ids.length) throw new CampaignError("Choose staff members from your organization.");
  const before = (await db.campaignMember.findMany({ where: { campaignId: c.id }, select: { userId: true } })).map((m) => m.userId);
  await db.$transaction([
    db.campaignMember.deleteMany({ where: { campaignId: c.id, userId: { notIn: ids } } }),
    db.campaignMember.createMany({ data: ids.map((userId) => ({ campaignId: c.id, userId })), skipDuplicates: true }),
  ]);
  return { added: ids.filter((i) => !before.includes(i)), removed: before.filter((i) => !ids.includes(i)) };
}

export async function setCampaignClients(db: Db, p: { organizationId: string; id: string; clientIds: string[] }) {
  const c = await db.campaign.findFirst({ where: { id: p.id, organizationId: p.organizationId } });
  if (!c) throw new CampaignError("Campaign not found.");
  const ids = [...new Set(p.clientIds.filter(Boolean))];
  if ((await db.client.count({ where: { id: { in: ids }, organizationId: p.organizationId } })) !== ids.length) throw new CampaignError("Choose clients from your organization.");
  await db.$transaction([
    db.campaignClient.deleteMany({ where: { campaignId: c.id, clientId: { notIn: ids } } }),
    db.campaignClient.createMany({ data: ids.map((clientId) => ({ campaignId: c.id, clientId })), skipDuplicates: true }),
  ]);
}

// A project belongs to at most one campaign. Linking moves it; null unlinks.
export async function linkProject(db: Db, p: { organizationId: string; projectId: string; campaignId: string | null }) {
  if (p.campaignId && !(await db.campaign.findFirst({ where: { id: p.campaignId, organizationId: p.organizationId } }))) throw new CampaignError("Campaign not found.");
  const r = await db.project.updateMany({ where: { id: p.projectId, organizationId: p.organizationId }, data: { campaignId: p.campaignId } });
  if (r.count === 0) throw new CampaignError("Project not found.");
}

export type CampaignFilters = { q?: string; status?: string; categoryId?: string; archived?: boolean; memberId?: string; ownerId?: string };

export function campaignWhere(organizationId: string, f: CampaignFilters): Prisma.CampaignWhereInput {
  return {
    organizationId,
    archivedAt: f.archived ? { not: null } : null,
    ...(f.status && (CAMPAIGN_STATUSES as readonly string[]).includes(f.status) ? { status: f.status } : {}),
    ...(f.categoryId ? { categoryId: f.categoryId } : {}),
    ...(f.ownerId ? { ownerId: f.ownerId } : {}),
    ...(f.memberId ? { members: { some: { userId: f.memberId } } } : {}),
    ...(f.q ? { OR: [{ name: { contains: f.q, mode: "insensitive" } }, { code: { contains: f.q, mode: "insensitive" } }, { description: { contains: f.q, mode: "insensitive" } }] } : {}),
  };
}

// Counts per campaign from the canonical rows: leads (and won), projects, open tasks in those projects, team size.
export async function campaignMetrics(db: Db, organizationId: string, ids: string[]) {
  if (ids.length === 0) return new Map<string, { leads: number; won: number; projects: number; openTasks: number; team: number; clients: number }>();
  const [leads, won, projects, tasks, team, clients] = await Promise.all([
    db.lead.groupBy({ by: ["campaignId"], where: { organizationId, campaignId: { in: ids } }, _count: true }),
    db.lead.groupBy({ by: ["campaignId"], where: { organizationId, campaignId: { in: ids }, OR: [{ clientId: { not: null } }, { stage: { isWon: true } }] }, _count: true }),
    db.project.groupBy({ by: ["campaignId"], where: { organizationId, campaignId: { in: ids } }, _count: true }),
    db.task.findMany({ where: { status: { not: "DONE" }, project: { organizationId, campaignId: { in: ids } } }, select: { project: { select: { campaignId: true } } } }),
    db.campaignMember.groupBy({ by: ["campaignId"], where: { campaignId: { in: ids } }, _count: true }),
    db.campaignClient.groupBy({ by: ["campaignId"], where: { campaignId: { in: ids } }, _count: true }),
  ]);
  const m = (rows: { campaignId: string | null; _count: number }[]) => new Map(rows.map((r) => [r.campaignId, r._count]));
  const [l, w, pr, tm, cl] = [m(leads), m(won), m(projects), m(team), m(clients)];
  const ot = new Map<string, number>();
  for (const t of tasks) if (t.project.campaignId) ot.set(t.project.campaignId, (ot.get(t.project.campaignId) ?? 0) + 1);
  return new Map(ids.map((id) => [id, { leads: l.get(id) ?? 0, won: w.get(id) ?? 0, projects: pr.get(id) ?? 0, openTasks: ot.get(id) ?? 0, team: tm.get(id) ?? 0, clients: cl.get(id) ?? 0 }]));
}
