// Closed Won approval requests. Free of Next.js imports so it can be tested against the database.
import { Prisma, type PrismaClient } from "@prisma/client";
import { LedgerError } from "./ledger-math";
import { convertLead, type ConversionResult } from "./conversion";
import { notify, notifyPermission } from "./notifications";

export const APPROVALS_LINK = "/leads/approvals";

// An agent asks for a lead to be won. Safe to repeat: a second ask while one is open returns the open one.
export async function requestConversion(
  db: PrismaClient,
  p: { organizationId: string; leadId: string; requesterId: string; requesterName: string; wonStageId: string; note?: string | null },
): Promise<{ id: string; alreadyPending: boolean }> {
  const lead = await db.lead.findFirst({ where: { id: p.leadId, organizationId: p.organizationId }, select: { id: true, name: true, number: true, clientId: true, convertedAt: true } });
  if (!lead) throw new LedgerError("Lead not found.");
  if (lead.clientId || lead.convertedAt) throw new LedgerError("This lead is already converted.");
  const open = await db.leadConversionRequest.findFirst({ where: { leadId: lead.id, status: "PENDING" } });
  if (open) return { id: open.id, alreadyPending: true };
  let id: string;
  try {
    const r = await db.leadConversionRequest.create({
      data: { organizationId: p.organizationId, leadId: lead.id, wonStageId: p.wonStageId, requestedById: p.requesterId, note: p.note?.trim().slice(0, 500) || null },
    });
    id = r.id;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const again = await db.leadConversionRequest.findFirstOrThrow({ where: { leadId: lead.id, status: "PENDING" } });
      return { id: again.id, alreadyPending: true };
    }
    throw e;
  }
  await db.leadActivity.create({ data: { leadId: lead.id, actorId: p.requesterId, kind: "NOTE", body: `Asked a manager to approve Closed Won${p.note?.trim() ? `: ${p.note.trim().slice(0, 500)}` : "."}` } });
  await notifyPermission(db, p.organizationId, "crm.convert", {
    kind: "LEAD_WON_APPROVAL", title: `Approve Closed Won: ${lead.name}`, body: `${p.requesterName} asked to convert lead L-${lead.number} into a client.`,
    link: APPROVALS_LINK, dedupeKey: `conv-req:${id}`,
  }, p.requesterId);
  return { id, alreadyPending: false };
}

export type DecisionResult = { ok: true; conversion?: ConversionResult } | { ok: false; error: string };

export async function approveConversion(db: PrismaClient, p: { organizationId: string; requestId: string; actorId: string }): Promise<DecisionResult> {
  const req = await db.leadConversionRequest.findFirst({ where: { id: p.requestId, organizationId: p.organizationId }, include: { lead: { select: { name: true, number: true } } } });
  if (!req) return { ok: false, error: "Request not found." };
  if (req.status !== "PENDING") return { ok: false, error: `Already ${req.status.toLowerCase()}.` };
  const conversion = await convertLead(db, { organizationId: p.organizationId, leadId: req.leadId, actorId: p.actorId, wonStageId: req.wonStageId });
  const won = await db.leadConversionRequest.updateMany({ where: { id: req.id, status: "PENDING" }, data: { status: "APPROVED", decidedById: p.actorId, decidedAt: new Date() } });
  if (won.count === 1) {
    await notify(db, req.requestedById, {
      kind: "LEAD_WON_DECISION", title: `Closed Won approved: ${req.lead.name}`, body: `Lead L-${req.lead.number} is now a client.`,
      link: `/leads/${req.leadId}`, dedupeKey: `conv-dec:${req.id}`,
    });
  }
  return { ok: true, conversion };
}

export async function rejectConversion(db: PrismaClient, p: { organizationId: string; requestId: string; actorId: string; reason: string }): Promise<DecisionResult> {
  const reason = p.reason.trim().slice(0, 500);
  if (reason.length < 3) return { ok: false, error: "Give the agent a short reason." };
  const req = await db.leadConversionRequest.findFirst({ where: { id: p.requestId, organizationId: p.organizationId }, include: { lead: { select: { name: true, number: true } } } });
  if (!req) return { ok: false, error: "Request not found." };
  const res = await db.leadConversionRequest.updateMany({ where: { id: req.id, status: "PENDING" }, data: { status: "REJECTED", decidedById: p.actorId, decidedAt: new Date(), decisionNote: reason } });
  if (res.count !== 1) return { ok: false, error: "This request was already decided." };
  await db.leadActivity.create({ data: { leadId: req.leadId, actorId: p.actorId, kind: "NOTE", body: `Closed Won not approved: ${reason}` } });
  await notify(db, req.requestedById, {
    kind: "LEAD_WON_DECISION", title: `Closed Won not approved: ${req.lead.name}`, body: reason, link: `/leads/${req.leadId}`, dedupeKey: `conv-dec:${req.id}`,
  });
  return { ok: true };
}
