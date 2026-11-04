// Prospector stage 5: sending prospects to the CRM. A prospect becomes a lead only here, and only a sales manager does it.
// Each sent prospect becomes a lead in the first open pipeline stage (with its contact), carrying the call note from the score as a lead
// note, the top service as the service of interest, a priority from the score, and an owner. The prospect is then marked SENT_TO_CRM
// with a link to its lead, and cannot be sent twice. Free of Next.js imports so it can be tested against the database.
import type { PrismaClient } from "@prisma/client";
import { ensureContactForLead, mirrorLeadActivity } from "./crm-contacts";
import { notify } from "./notifications";
import { countryName, phoneTail } from "./phone";
import { assignableAgents, isManager, ProspectorError, type Actor } from "./prospector";
import { scoreOne, serviceLabel } from "./prospect-scoring";

type Db = PrismaClient;
export const MAX_SEND_PER_CLICK = 50;
export const PROSPECTOR_SOURCE = "Prospector";
export const priorityFor = (score: number | null) => (score !== null && score >= 60 ? "HIGH" : score !== null && score >= 35 ? "MEDIUM" : "LOW");

export type SendSummary = { sent: number; alreadyLead: number; noPhone: number; blocked: number; skipped: number; unavailable: number; left: number; byAgent: { agentId: string; name: string; count: number }[]; leadIds: string[] };

// who: "TEAM" shares the leads fairly across the sales team; a user id gives all of them to that person.
// A prospect that a manager already assigned to someone keeps that person as the owner of its lead.
export async function sendToCrm(db: Db, actor: Actor, ids: string[], opts: { who: string; now?: Date }): Promise<SendSummary> {
  if (!isManager(actor)) throw new ProspectorError("Only a sales manager can send prospects to the CRM.");
  const org = actor.organizationId;
  const now = opts.now ?? new Date();
  const wanted = [...new Set(ids)];
  const out: SendSummary = { sent: 0, alreadyLead: 0, noPhone: 0, blocked: 0, skipped: 0, unavailable: 0, left: 0, byAgent: [], leadIds: [] };
  const agents = await assignableAgents(db, org);
  const agentName = new Map(agents.map((a) => [a.id, a.name]));
  let pool = agents.map((a) => a.id);
  if (opts.who !== "TEAM") {
    if (!agentName.has(opts.who)) throw new ProspectorError("Choose an active sales team member, or the whole team.");
    pool = [opts.who];
  }
  if (pool.length === 0) throw new ProspectorError("There is nobody on the sales team to own the leads yet.");

  // best first, so with a limit per click the strongest are sent
  const rows = await db.prospect.findMany({ where: { organizationId: org, id: { in: wanted } }, orderBy: [{ score: { sort: "desc", nulls: "last" } }, { createdAt: "asc" }] });
  out.unavailable = wanted.length - rows.length;
  const todo = rows.filter((r) => { if (r.status === "SENT_TO_CRM" || r.status === "DISMISSED") { out.skipped++; return false; } return true; });
  const batch = todo.slice(0, MAX_SEND_PER_CLICK);
  out.left = todo.length - batch.length;
  if (batch.length === 0) return out;

  const stage = await db.pipelineStage.findFirst({ where: { organizationId: org, isWon: false, isLost: false }, orderBy: { sortOrder: "asc" } });
  if (!stage) throw new ProspectorError("The pipeline has no open stage to put new leads in.");
  const [leads, blocked, load] = await Promise.all([
    db.lead.findMany({ where: { organizationId: org, phone: { not: null } }, select: { id: true, phone: true } }),
    db.suppressedContact.findMany({ where: { organizationId: org }, select: { phone: true } }),
    db.lead.groupBy({ by: ["assignedToId"], where: { organizationId: org, source: PROSPECTOR_SOURCE, assignedToId: { in: pool } }, _count: true }),
  ]);
  const leadByTail = new Map(leads.map((l) => [phoneTail(l.phone), l.id] as const).filter(([t]) => t) as [string, string][]);
  const blockedTails = new Set(blocked.map((b) => phoneTail(b.phone)).filter(Boolean) as string[]);
  // fair share: the next lead goes to whoever has the fewest from Prospector so far, counting the ones given out in this batch
  const given = new Map<string, number>(pool.map((id) => [id, load.find((l) => l.assignedToId === id)?._count ?? 0]));
  const nextOwner = () => [...given.entries()].sort((a, b) => a[1] - b[1] || pool.indexOf(a[0]) - pool.indexOf(b[0]))[0][0];
  const counts = new Map<string, number>();

  for (const p of batch) {
    const tail = phoneTail(p.phone);
    if (!tail) { out.noPhone++; continue; }
    if (blockedTails.has(tail)) { out.blocked++; continue; }
    const existing = leadByTail.get(tail);
    if (existing) {
      // already in the CRM (found some other way): link it instead of making a second lead
      const claimed = await db.prospect.updateMany({ where: { id: p.id, status: { notIn: ["SENT_TO_CRM", "DISMISSED"] } }, data: { status: "SENT_TO_CRM", leadId: existing } });
      if (claimed.count === 1) out.alreadyLead++; else out.skipped++;
      continue;
    }
    const s = await scoreOne(db, org, p.id, now);
    const owner = p.assignedToId && agentName.has(p.assignedToId) ? p.assignedToId : nextOwner();
    const service = serviceLabel(s?.topService ?? null);
    const created = await db.$transaction(async (tx) => {
      // claim the prospect first: two people pressing the button together cannot both create a lead
      const claimed = await tx.prospect.updateMany({ where: { id: p.id, status: { notIn: ["SENT_TO_CRM", "DISMISSED"] } }, data: { status: "SENT_TO_CRM" } });
      if (claimed.count !== 1) return null;
      const links = [p.website ? `Website: ${p.website}` : null, p.mapsUrl ? `Google Maps: ${p.mapsUrl}` : null].filter(Boolean).join("\n") || null;
      const lead = await tx.lead.create({
        data: {
          organizationId: org, name: p.name.slice(0, 200), company: p.name.slice(0, 160), phone: p.phone, city: p.city, country: p.country ? countryName(p.country) : null,
          source: PROSPECTOR_SOURCE, serviceInterest: service, priority: priorityFor(s?.score ?? p.score), stageId: stage.id, assignedToId: owner, createdById: actor.id, notes: links,
          tags: ["prospector", ...(s?.topService ? [s.topService.toLowerCase()] : [])],
          activities: { create: { actorId: actor.id, kind: "CREATED", body: `Sent from Prospector (opportunity ${s?.score ?? p.score ?? "not scored"} of 100)${p.address ? `. ${p.address}` : ""}` } },
        },
      });
      await tx.prospect.update({ where: { id: p.id }, data: { leadId: lead.id } });
      if (s) {
        const note = await tx.leadActivity.create({ data: { leadId: lead.id, actorId: actor.id, kind: "NOTE", body: s.pitch } });
        await ensureContactForLead(tx, lead.id);
        await mirrorLeadActivity(tx, note.id);
      } else await ensureContactForLead(tx, lead.id);
      return { leadId: lead.id };
    });
    if (!created) { out.skipped++; continue; }
    out.sent++; out.leadIds.push(created.leadId);
    leadByTail.set(tail, created.leadId);
    if (given.has(owner)) given.set(owner, given.get(owner)! + 1); // a prospect that kept its own assignee does not change who is chosen for the rest
    counts.set(owner, (counts.get(owner) ?? 0) + 1);
  }
  out.byAgent = [...counts.entries()].map(([agentId, count]) => ({ agentId, name: agentName.get(agentId) ?? "Unknown", count }));
  // one notification per person, not one per lead
  for (const a of out.byAgent) {
    if (a.agentId === actor.id) continue;
    await notify(db, a.agentId, { kind: "lead.assigned", title: a.count === 1 ? "A new lead from Prospector is yours" : `${a.count} new leads from Prospector are yours`, body: "Each has a call note with what to say.", link: "/leads", dedupeKey: `prospector-leads:${a.agentId}:${now.getTime()}` });
  }
  return out;
}
