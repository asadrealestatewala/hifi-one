"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { audit, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { leadScope, normalizePhone } from "@/lib/leads";
import { convertLead } from "@/lib/conversion";
import { ensureContactForLead, mirrorLeadActivity } from "@/lib/crm-contacts";
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
  // Duplicate detection on email or phone within the organization (all leads, not just visible ones)
  const phone = normalizePhone(d.phone);
  const or = [d.email ? { email: d.email } : null, phone ? { phone } : null].filter(Boolean) as { email?: string; phone?: string }[];
  if (or.length && !d.confirmDuplicate) {
    const dup = await db.lead.findFirst({ where: { organizationId: user.organizationId, OR: or } });
    if (dup) {
      redirect(`/leads?error=${encodeURIComponent("A lead with this email or phone already exists. Tick the box to create it anyway.")}&dup=1`);
    }
  }
  if (d.expectedCloseDate && Number.isNaN(Date.parse(d.expectedCloseDate))) redirect(`/leads?error=${encodeURIComponent("Enter a valid expected closing date")}`);
  if (d.campaignId && !(await db.campaign.findFirst({ where: { id: d.campaignId, organizationId: user.organizationId } }))) redirect(`/leads?error=${encodeURIComponent("Unknown campaign")}`);
  const stage = await db.pipelineStage.findFirstOrThrow({ where: { organizationId: user.organizationId }, orderBy: { sortOrder: "asc" } });
  const lead = await db.lead.create({
    data: {
      organizationId: user.organizationId,
      name: d.name, company: d.company, email: d.email, phone, country: d.country, city: d.city, source: d.source,
      preferredContact: d.preferredContact, expectedCloseDate: d.expectedCloseDate, tags: d.tags, campaignId: d.campaignId,
      serviceInterest: d.serviceInterest, dealValue: d.dealValue, currency: d.currency, priority: d.priority,
      stageId: stage.id, assignedToId: user.id, createdById: user.id,
      activities: { create: { kind: "CREATED", actorId: user.id, body: "Lead created" } },
    },
  });
  await ensureContactForLead(db, lead.id);
  await audit(user, { action: "lead.create", entity: "Lead", entityId: lead.id, after: { name: lead.name, stage: stage.name } });
  revalidatePath("/leads");
  redirect(`/leads/${lead.id}`);
}

export type MoveResult = { ok: true } | { ok: false; error: string };

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
      return { ok: false, error: "Closed Won needs manager approval. Ask a sales manager to convert this lead." };
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
