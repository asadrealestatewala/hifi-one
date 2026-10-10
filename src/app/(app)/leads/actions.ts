"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { audit, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { leadScope, normalizePhone } from "@/lib/leads";

const opt = z.string().trim().max(500).optional().transform((v) => (v ? v : null));

const createSchema = z.object({
  name: z.string().trim().min(2, "Name is required").max(200),
  company: opt,
  email: z.string().trim().email("Enter a valid email").or(z.literal("")).transform((v) => (v ? v.toLowerCase() : null)),
  phone: opt,
  country: opt,
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
  const stage = await db.pipelineStage.findFirstOrThrow({ where: { organizationId: user.organizationId }, orderBy: { sortOrder: "asc" } });
  const lead = await db.lead.create({
    data: {
      organizationId: user.organizationId,
      name: d.name, company: d.company, email: d.email, phone, country: d.country, source: d.source,
      serviceInterest: d.serviceInterest, dealValue: d.dealValue, currency: d.currency, priority: d.priority,
      stageId: stage.id, assignedToId: user.id, createdById: user.id,
      activities: { create: { kind: "CREATED", actorId: user.id, body: "Lead created" } },
    },
  });
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
    return { ok: false, error: "Closed Won needs the client conversion workflow (invoice, contract, project), which is built in a later phase. Not changed." };
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
  await db.leadActivity.create({ data: { leadId, actorId: user.id, kind: "NOTE", body } });
  revalidatePath(`/leads/${leadId}`);
}
