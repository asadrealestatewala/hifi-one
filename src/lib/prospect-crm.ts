// Prospector stage 5: from prospect to lead. A prospect is fresh data that nobody has talked to. A manager assigns it, the salesperson
// calls, and logs the outcome here:
//   CONTACTED      still being worked on (status Contacted)
//   NOT_INTERESTED closes the prospect (status Not interested); it is kept so it is not found, assigned or called again
//   INTERESTED     turns the prospect into a CRM lead in the same step (status Converted, with a link to the lead)
// A lead never goes back to being a prospect: if it goes cold later it stays in the CRM with a lost status. Converting keeps the owner,
// carries the call note from the score and the contact history as lead notes, and refuses numbers on the do-not-contact list.
// Free of Next.js imports so it can be tested against the database.
import type { PrismaClient } from "@prisma/client";
import { ensureContactForLead, mirrorLeadActivity } from "./crm-contacts";
import { notify } from "./notifications";
import { countryName, phoneTail } from "./phone";
import { DuplicateLeadError, claimLeadKeys, findLeadDuplicates, getPolicy, guardNewLead, presentDuplicate } from "./lead-duplicates";
import { isManager, ProspectorError, type Actor } from "./prospector";
import { scoreOne, serviceLabel } from "./prospect-scoring";

type Db = PrismaClient;
export const PROSPECTOR_SOURCE = "Prospector";
export const OUTCOMES = ["CONTACTED", "INTERESTED", "NOT_INTERESTED"] as const;
export type Outcome = (typeof OUTCOMES)[number];
export const OUTCOME_LABEL: Record<string, string> = { CONTACTED: "Contacted", INTERESTED: "Interested", NOT_INTERESTED: "Not interested" };
export const priorityFor = (score: number | null) => (score !== null && score >= 60 ? "HIGH" : score !== null && score >= 35 ? "MEDIUM" : "LOW");
const NOTE_MAX = 1000;
const CLOSED = ["SENT_TO_CRM", "DISMISSED", "NOT_INTERESTED"];
const closedMessage = (status: string) =>
  status === "SENT_TO_CRM" ? "This prospect is already a lead. Log activity on the lead instead."
  : status === "NOT_INTERESTED" ? "This prospect said it is not interested and is closed. A manager can restore it if that changes."
  : "This prospect was dismissed. A manager can restore it first.";

export type LogResult = { outcome: Outcome; leadId: string | null; linkedExisting: boolean };

// The owner of a prospect logs its contacts; a sales manager can log for anyone. Nobody else can.
export async function logOutreach(db: Db, actor: Actor, prospectId: string, p: { outcome: string; note?: string; now?: Date }): Promise<LogResult> {
  if (!(OUTCOMES as readonly string[]).includes(p.outcome)) throw new ProspectorError("Choose what happened: contacted, interested or not interested.");
  const outcome = p.outcome as Outcome;
  const note = (p.note ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim().slice(0, NOTE_MAX) || null;
  const org = actor.organizationId;
  const now = p.now ?? new Date();
  const row = await db.prospect.findFirst({ where: { id: prospectId, organizationId: org } });
  if (!row || (!isManager(actor) && row.assignedToId !== actor.id)) throw new ProspectorError("Only the salesperson this prospect is assigned to, or a sales manager, can log contact.");
  if (CLOSED.includes(row.status)) throw new ProspectorError(closedMessage(row.status));
  const log = { organizationId: org, prospectId, userId: actor.id, outcome, note, createdAt: now };

  if (outcome !== "INTERESTED") {
    // the status condition makes a second click or a second person lose cleanly instead of overwriting a closed prospect
    const done = await db.$transaction(async (tx) => {
      const moved = await tx.prospect.updateMany({ where: { id: prospectId, status: { notIn: CLOSED } }, data: { status: outcome === "CONTACTED" ? "CONTACTED" : "NOT_INTERESTED" } });
      if (moved.count !== 1) return false;
      await tx.prospectOutreach.create({ data: log });
      return true;
    });
    if (!done) throw new ProspectorError("This prospect was just closed by someone else.");
    return { outcome, leadId: null, linkedExisting: false };
  }

  // Interested: becomes a lead now
  const tail = phoneTail(row.phone);
  let existingLeadId: string | null = null;
  if (tail) {
    const blocked = await db.suppressedContact.findMany({ where: { organizationId: org }, select: { phone: true } });
    if (blocked.some((b) => phoneTail(b.phone) === tail)) throw new ProspectorError("This number is on the do-not-contact list, so it cannot become a lead.");
  }
  // One person, one lead (lead-duplicates.ts): a lead that already has this phone is linked instead of copied, whatever its status
  const policy = await getPolicy(db, org);
  if (row.phone && policy.mode !== "OFF") existingLeadId = (await findLeadDuplicates(db, { organizationId: org, phone: row.phone, country: row.country }, policy))[0]?.leadId ?? null;
  const stage = await db.pipelineStage.findFirst({ where: { organizationId: org, isWon: false, isLost: false }, orderBy: { sortOrder: "asc" } });
  if (!stage && !existingLeadId) throw new ProspectorError("The pipeline has no open stage to put new leads in.");
  const s = existingLeadId ? null : await scoreOne(db, org, row.id, now);
  const owner = row.assignedToId ?? actor.id;
  const service = serviceLabel(s?.topService ?? null);

  const leadId = await db.$transaction(async (tx) => {
    // claim the prospect first: two people pressing together cannot both create a lead
    const claimed = await tx.prospect.updateMany({ where: { id: prospectId, status: { notIn: CLOSED } }, data: { status: "SENT_TO_CRM" } });
    if (claimed.count !== 1) return null;
    await tx.prospectOutreach.create({ data: log });
    if (existingLeadId) { await tx.prospect.update({ where: { id: prospectId }, data: { leadId: existingLeadId } }); return existingLeadId; }
    // the shared guard: locks the number, re-checks (someone may have added the lead a moment ago) and claims it below
    const guard = await guardNewLead(tx, { organizationId: org, phone: row.phone, country: row.country });
    const history = await tx.prospectOutreach.findMany({ where: { prospectId }, orderBy: { createdAt: "asc" } });
    const names = new Map((await tx.user.findMany({ where: { id: { in: [...new Set(history.map((h) => h.userId))] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
    const contactNote = `Contact history before this became a lead:\n${history.map((h) => `${h.createdAt.toISOString().slice(0, 10)} · ${names.get(h.userId) ?? "Someone"} · ${OUTCOME_LABEL[h.outcome] ?? h.outcome}${h.note ? `: ${h.note}` : ""}`).join("\n")}`;
    const links = [row.website ? `Website: ${row.website}` : null, row.mapsUrl ? `Google Maps: ${row.mapsUrl}` : null].filter(Boolean).join("\n") || null;
    const lead = await tx.lead.create({
      data: {
        organizationId: org, name: row.name.slice(0, 200), company: row.name.slice(0, 160), phone: row.phone, city: row.city, country: row.country ? countryName(row.country) : null,
        source: PROSPECTOR_SOURCE, serviceInterest: service, priority: priorityFor(s?.score ?? row.score), stageId: stage!.id, assignedToId: owner, createdById: actor.id, notes: links,
        lastContactAt: now, tags: ["prospector", ...(s?.topService ? [s.topService.toLowerCase()] : [])],
        activities: { create: { actorId: actor.id, kind: "CREATED", body: `Converted from Prospector after the business said it is interested (opportunity ${s?.score ?? row.score ?? "not scored"} of 100)${row.address ? `. ${row.address}` : ""}` } },
      },
    });
    await claimLeadKeys(tx, { leadId: lead.id, organizationId: org, phone: row.phone, country: row.country }, { policy: guard.policy });
    await tx.prospect.update({ where: { id: prospectId }, data: { leadId: lead.id } });
    await ensureContactForLead(tx, lead.id);
    for (const body of [contactNote, s?.pitch].filter(Boolean) as string[]) {
      const n = await tx.leadActivity.create({ data: { leadId: lead.id, actorId: actor.id, kind: "NOTE", body } });
      await mirrorLeadActivity(tx, n.id);
    }
    return lead.id;
  }).catch((e: unknown) => {
    // someone added a lead with this number while we were converting: say so the way the rest of the CRM does
    if (e instanceof DuplicateLeadError) throw new ProspectorError(e.matches[0] ? presentDuplicate(e.matches[0], { id: actor.id, permissions: actor.permissions }).text : e.message);
    throw e;
  });
  if (!leadId) throw new ProspectorError("This prospect was just converted or closed by someone else.");
  if (!existingLeadId && owner !== actor.id) await notify(db, owner, { kind: "lead.assigned", title: `${row.name} is now a lead and is yours`, body: "From Prospector, with the contact history and a call note.", link: `/leads/${leadId}`, dedupeKey: `prospect-lead:${leadId}` });
  return { outcome, leadId, linkedExisting: Boolean(existingLeadId) };
}
