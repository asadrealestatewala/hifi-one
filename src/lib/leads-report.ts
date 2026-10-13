// The leads report: how many leads came in, where they stand, where they came from, who is working them, and how many turned into clients.
// `where` is the caller's own visibility rule (leadScope), so people only ever see leads they are allowed to see.
import type { Prisma, PrismaClient } from "@prisma/client";

const startOfDay = (d: string) => new Date(`${d}T00:00:00.000Z`);
const endOfDay = (d: string) => new Date(`${d}T23:59:59.999Z`);

export async function loadLeadsReport(db: PrismaClient, organizationId: string, where: Prisma.LeadWhereInput, range: { from: string; to: string }) {
  const inRange = { gte: startOfDay(range.from), lte: endOfDay(range.to) };
  const [stages, leads] = await Promise.all([
    db.pipelineStage.findMany({ where: { organizationId }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true, isWon: true, isLost: true } }),
    db.lead.findMany({ where, select: { id: true, name: true, number: true, source: true, stageId: true, assignedToId: true, dealValue: true, currency: true, createdAt: true, convertedAt: true, stageChangedAt: true, clientId: true }, orderBy: { createdAt: "desc" }, take: 5000 }),
  ]);
  const stageOf = new Map(stages.map((s) => [s.id, s]));
  const created = leads.filter((l) => l.createdAt >= inRange.gte && l.createdAt <= inRange.lte);
  const won = leads.filter((l) => l.convertedAt && l.convertedAt >= inRange.gte && l.convertedAt <= inRange.lte);
  const lost = leads.filter((l) => stageOf.get(l.stageId)?.isLost && l.stageChangedAt >= inRange.gte && l.stageChangedAt <= inRange.lte);
  const open = leads.filter((l) => { const s = stageOf.get(l.stageId); return s && !s.isWon && !s.isLost; });
  const decided = won.length + lost.length;

  const money = (rows: typeof leads) => {
    const m = new Map<string, { value: number; count: number }>();
    for (const l of rows) { const c = m.get(l.currency) ?? { value: 0, count: 0 }; c.count++; c.value += Number(l.dealValue ?? 0); m.set(l.currency, c); }
    return [...m].map(([currency, v]) => ({ currency, value: v.value.toFixed(2), count: v.count }));
  };
  const bySource = new Map<string, { source: string; leads: number; won: number }>();
  for (const l of created) { const k = l.source?.trim() || "Not recorded"; const r = bySource.get(k) ?? { source: k, leads: 0, won: 0 }; r.leads++; if (l.convertedAt) r.won++; bySource.set(k, r); }
  const byOwner = new Map<string, { id: string | null; leads: number; won: number }>();
  for (const l of created) { const k = l.assignedToId ?? "none"; const r = byOwner.get(k) ?? { id: l.assignedToId, leads: 0, won: 0 }; r.leads++; if (l.convertedAt) r.won++; byOwner.set(k, r); }
  // New leads per week across the period, so a trend is visible
  const weeks: { start: string; count: number }[] = [];
  const first = startOfDay(range.from);
  for (let t = first.getTime(); t <= inRange.lte.getTime(); t += 7 * 86400000) weeks.push({ start: new Date(t).toISOString().slice(0, 10), count: 0 });
  for (const l of created) { const i = Math.min(weeks.length - 1, Math.floor((l.createdAt.getTime() - first.getTime()) / (7 * 86400000))); if (i >= 0) weeks[i].count++; }

  return {
    total: leads.length, created: created.length, won: won.length, lost: lost.length, open: open.length,
    conversion: decided === 0 ? null : Math.round((won.length / decided) * 100),
    pipeline: money(open),
    funnel: stages.map((s) => { const rows = leads.filter((l) => l.stageId === s.id); return { id: s.id, name: s.name, won: s.isWon, lost: s.isLost, count: rows.length, money: money(rows) }; }),
    bySource: [...bySource.values()].sort((a, b) => b.leads - a.leads).slice(0, 10),
    byOwner: [...byOwner.values()].sort((a, b) => b.leads - a.leads).slice(0, 10),
    weeks,
    recent: created.slice(0, 8).map((l) => ({ id: l.id, name: l.name, number: l.number, stage: stageOf.get(l.stageId)?.name ?? "", createdAt: l.createdAt })),
  };
}
