"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { audit, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { leadScope, normalizePhone } from "@/lib/leads";
import { convertLead } from "@/lib/conversion";
import { approveConversion, rejectConversion, requestConversion, type DecisionResult } from "@/lib/conversion-requests";
import { ensureContactForLead, mirrorLeadActivity } from "@/lib/crm-contacts";
import { DuplicateLeadError, canonicalPhone, createLeadGuarded, presentDuplicate } from "@/lib/lead-duplicates";
import { LedgerError } from "@/lib/ledger-math";

const opt = z.string().trim().max(500).optional().transform((v) => (v ? v : null));

const createSchema = z.object({
  name: z.string().trim().min(2, "Name is required").max(200),
  company: opt,
  email: z.string().trim().email("Enter a valid email").or(z.literal("")).transform((v) => (v ? v.toLowerCase() : null)),
  phone: opt,
  country: opt,
  city: opt,
  preferredContact: z.enum(["CALL", "WHATSAPP", "EMAIL", "SMS"]).or(z.literal("")).transform((v) => (v ? v : null)),
  expectedCloseDate: z.string().trim().optional().transform((v) => (v ? v : null)),
  campaignId: opt,
  tags: z.string().trim().max(300).optional().transform((v) => (v ? v.split(",").map((x) => x.trim().toLowerCase().slice(0, 30)).filter(Boolean).slice(0, 12) : [])),
  source: opt,
  serviceInterest: opt,
  dealValue: z.string().trim().optional().transform((v) => (v ? v : null)),
  currency: z.enum(["PKR", "USD", "AED", "GBP"]).default("USD"),
  priority: z.enum(["LOW", "MEDIUM", "HIGH"]).default("MEDIUM"),
  confirmDuplicate: z.string().optional(),
});

export async function createLead(formData: FormData) {
  const user = await requirePermission("crm.edit");
  const parsed = createSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    redirect(`/leads?error=${encodeURIComponent(parsed.error.issues[0].message)}`);
  }
  const d = parsed.data;
  if (d.dealValue !== null && !/^\d{1,12}(\.\d{1,2})?$/.test(d.dealValue)) {
    redirect(`/leads?error=${encodeURIComponent("Deal value must be a positive number")}`);
  }
  const phoneTyped = normalizePhone(d.phone);
  const phone = phoneTyped ? await canonicalPhone(db, user.organizationId, phoneTyped, d.country) : null;
  if (d.expectedCloseDate && Number.isNaN(Date.parse(d.expectedCloseDate))) redirect(`/leads?error=${encodeURIComponent("Enter a valid expected closing date")}`);
  if (d.campaignId && !(await db.campaign.findFirst({ where: { id: d.campaignId, organizationId: user.organizationId } }))) redirect(`/leads?error=${encodeURIComponent("Unknown campaign")}`);
  const stage = await db.pipelineStage.findFirstOrThrow({ where: { organizationId: user.organizationId }, orderBy: { sortOrder: "asc" } });
  let lead;
  try {
    lead = await createLeadGuarded(db, { organizationId: user.organizationId, email: d.email, phone, country: d.country, confirm: !!d.confirmDuplicate }, (tx) => tx.lead.create({
      data: {
        organizationId: user.organizationId,
        name: d.name, company: d.company, email: d.email, phone, country: d.country, city: d.city, source: d.source,
        preferredContact: d.preferredContact, expectedCloseDate: d.expectedCloseDate, tags: d.tags, campaignId: d.campaignId,
        serviceInterest: d.serviceInterest, dealValue: d.dealValue, currency: d.currency, priority: d.priority,
        stageId: stage.id, assignedToId: user.id, createdById: user.id,
        activities: { create: { kind: "CREATED", actorId: user.id, body: "Lead created" } },
      },
    }));
  } catch (e) {
    if (e instanceof DuplicateLeadError) {
      const shown = presentDuplicate(e.matches[0], user);
      await audit(user, { action: "lead.duplicate_blocked", entity: "Lead", entityId: e.matches[0]?.leadId, after: { existingLeadId: e.matches[0]?.leadId, matchedOn: e.matches[0]?.matchedOn } });
      redirect(`/leads?error=${encodeURIComponent(shown.text)}${shown.href ? `&dupHref=${encodeURIComponent(shown.href)}` : ""}${e.canConfirm ? "&dup=1" : ""}`);
    }
    throw e;
  }
  await ensureContactForLead(db, lead.id);
  await audit(user, { action: "lead.create", entity: "Lead", entityId: lead.id, after: { name: lead.name, stage: stage.name } });
  revalidatePath("/leads");
  redirect(`/leads/${lead.id}`);
}

export type MoveResult = { ok: true; info?: string } | { ok: false; error: string };

// Used by the board (drag and drop) and the stage selector on the lead page.
export async function moveLead(leadId: string, stageId: string): Promise<MoveResult> {
  const user = await requirePermission("crm.edit");
  const lead = await db.lead.findFirst({ where: { id: leadId, ...leadScope(user) }, include: { stage: true } });
  if (!lead) return { ok: false, error: "Lead not found or not accessible." };
  const stage = await db.pipelineStage.findFirst({ where: { id: stageId, organizationId: user.organizationId } });
  if (!stage) return { ok: false, error: "Unknown stage." };
  if (stage.id === lead.stageId) return { ok: true };
  if (stage.isWon) {
    // Closed Won is a controlled conversion, never just a label change, and needs manager approval.
    if (!user.permissions.has("crm.convert")) {
      // No permission: send an approval request to the sales managers instead of failing. The lead stays where it is.
      try {
        const r = await requestConversion(db, { organizationId: user.organizationId, leadId: lead.id, requesterId: user.id, requesterName: user.name, wonStageId: stage.id });
        if (!r.alreadyPending) await audit(user, { action: "lead.convert_requested", entity: "Lead", entityId: lead.id, after: { requestId: r.id } });
        revalidatePath(`/leads/${lead.id}`);
        return { ok: true, info: r.alreadyPending ? "Already waiting for manager approval." : "Closed Won needs manager approval. Your request was sent to the sales managers; the lead stays in its stage until they approve." };
      } catch (e) {
        if (e instanceof LedgerError) return { ok: false, error: e.message };
        throw e;
      }
    }
    try {
      const r = await convertLead(db, { organizationId: user.organizationId, leadId: lead.id, actorId: user.id, wonStageId: stage.id });
      await audit(user, { action: "lead.convert", entity: "Lead", entityId: lead.id, after: { clientId: r.clientId, invoiceId: r.invoiceId, alreadyConverted: r.alreadyConverted } });
    } catch (e) {
      if (e instanceof LedgerError) return { ok: false, error: e.message };
      throw e;
    }
    revalidatePath("/pipeline");
    revalidatePath("/leads");
    revalidatePath(`/leads/${lead.id}`);
    return { ok: true };
  }
  await db.$transaction([
    db.lead.update({ where: { id: lead.id }, data: { stageId: stage.id, stageChangedAt: new Date() } }),
    db.leadActivity.create({
      data: { leadId: lead.id, actorId: user.id, kind: "STAGE_CHANGE", body: `${lead.stage.name} → ${stage.name}` },
    }),
  ]);
  await audit(user, { action: "lead.stage_change", entity: "Lead", entityId: lead.id, before: { stage: lead.stage.name }, after: { stage: stage.name } });
  revalidatePath("/pipeline");
  revalidatePath("/leads");
  revalidatePath(`/leads/${lead.id}`);
  return { ok: true };
}

export async function addNote(formData: FormData) {
  const user = await requirePermission("crm.edit");
  const leadId = String(formData.get("leadId"));
  const body = String(formData.get("body") ?? "").trim().slice(0, 2000);
  if (!body) return;
  const lead = await db.lead.findFirst({ where: { id: leadId, ...leadScope(user) } });
  if (!lead) return;
  const na = await db.leadActivity.create({ data: { leadId, actorId: user.id, kind: "NOTE", body } });
  await mirrorLeadActivity(db, na.id);
  revalidatePath(`/leads/${leadId}`);
}

export async function approveConversionAction(requestId: string): Promise<DecisionResult> {
  const user = await requirePermission("crm.convert");
  const r = await approveConversion(db, { organizationId: user.organizationId, requestId, actorId: user.id }).catch((e) => {
    if (e instanceof LedgerError) return { ok: false, error: e.message } as DecisionResult;
    throw e;
  });
  if (r.ok) await audit(user, { action: "lead.convert", entity: "LeadConversionRequest", entityId: requestId, after: { clientId: r.conversion?.clientId, invoiceId: r.conversion?.invoiceId } });
  revalidatePath("/leads/approvals");
  revalidatePath("/pipeline");
  revalidatePath("/leads");
  return r;
}

export async function rejectConversionAction(requestId: string, reason: string): Promise<DecisionResult> {
  const user = await requirePermission("crm.convert");
  const r = await rejectConversion(db, { organizationId: user.organizationId, requestId, actorId: user.id, reason });
  if (r.ok) await audit(user, { action: "lead.convert_rejected", entity: "LeadConversionRequest", entityId: requestId, after: { reason: reason.trim().slice(0, 500) } });
  revalidatePath("/leads/approvals");
  return r;
}
