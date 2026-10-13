"use server";

import { redirect } from "next/navigation";
import { audit, requirePermission } from "@/lib/auth";
import { CrmError, cleanFilters, deleteSmartList, logActivity, saveCampaign, saveSmartList, setTarget, verifyActivity } from "@/lib/crm";
import { ensureContactForLead, mirrorLeadActivity } from "@/lib/crm-contacts";
import { db } from "@/lib/db";
import { leadScope } from "@/lib/leads";
import { leadAssigned } from "@/lib/events";

const s = (f: FormData, k: string) => String(f.get(k) ?? "");
const flash = (to: string, kind: "error" | "msg", m: string) => redirect(`${to}${to.includes("?") ? "&" : "?"}${kind}=${encodeURIComponent(m)}`);

export async function logActivityAction(formData: FormData) {
  const user = await requirePermission("crm.edit");
  const leadId = s(formData, "leadId");
  const back = `/leads/${leadId}`;
  // The lead must be one this person may open
  if (!(await db.lead.findFirst({ where: { id: leadId, ...leadScope(user) }, select: { id: true } }))) redirect("/leads");
  try {
    const a = await logActivity(db, { organizationId: user.organizationId, leadId, actorId: user.id, kind: s(formData, "kind"), outcome: s(formData, "outcome") || undefined, body: s(formData, "body"), nextFollowUp: s(formData, "nextFollowUp") || null });
    await mirrorLeadActivity(db, a.id);
    await audit(user, { action: "lead.activity", entity: "Lead", entityId: leadId, after: { kind: a.kind, outcome: a.outcome } });
  } catch (e) {
    if (e instanceof CrmError) return flash(back, "error", e.message);
    throw e;
  }
  redirect(back);
}

export async function updateLeadDetails(formData: FormData) {
  const user = await requirePermission("crm.edit");
  const id = s(formData, "leadId");
  const back = `/leads/${id}`;
  const lead = await db.lead.findFirst({ where: { id, ...leadScope(user) } });
  if (!lead) redirect("/leads");
  const t = (k: string, max = 120) => s(formData, k).trim().slice(0, max) || null;
  const expected = t("expectedCloseDate", 10);
  if (expected && Number.isNaN(Date.parse(expected))) return flash(back, "error", "Enter a valid expected closing date.");
  const preferred = t("preferredContact", 10);
  if (preferred && !["CALL", "WHATSAPP", "EMAIL", "SMS"].includes(preferred)) return flash(back, "error", "Choose a preferred contact method.");
  const tz = t("timezone", 60);
  if (tz) { try { new Intl.DateTimeFormat("en", { timeZone: tz }); } catch { return flash(back, "error", "That time zone is not recognised (for example Asia/Karachi)."); } }
  const campaignId = t("campaignId", 40);
  if (campaignId && !(await db.campaign.findFirst({ where: { id: campaignId, organizationId: user.organizationId } }))) return flash(back, "error", "Unknown campaign.");
  const assignedToId = t("assignedToId", 40);
  if (assignedToId && !(await db.user.findFirst({ where: { id: assignedToId, organizationId: user.organizationId, active: true, userType: "EMPLOYEE" } }))) return flash(back, "error", "Unknown sales agent.");
  const dealRaw = s(formData, "dealValue").trim();
  if (dealRaw && !/^\d{1,12}(\.\d{1,2})?$/.test(dealRaw)) return flash(back, "error", "Deal value must be a positive number.");
  const tags = s(formData, "tags").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean).slice(0, 12).map((x) => x.slice(0, 30));
  const before = { city: lead.city, campaignId: lead.campaignId, assignedToId: lead.assignedToId, tags: lead.tags };
  // Only a manager may reassign the lead to someone else
  const reassign = assignedToId !== lead.assignedToId && !user.permissions.has("crm.view_all") ? lead.assignedToId : assignedToId;
  await db.lead.update({
    where: { id },
    data: {
      city: t("city", 80), timezone: tz, preferredContact: preferred, expectedCloseDate: expected, campaignId, tags, assignedToId: reassign,
      dealValue: dealRaw || null, source: t("source", 80), serviceInterest: t("serviceInterest", 120), country: t("country", 80), company: t("company", 160),
      priority: ["LOW", "MEDIUM", "HIGH"].includes(s(formData, "priority")) ? s(formData, "priority") : lead.priority,
    },
  });
  await ensureContactForLead(db, id);
  await audit(user, { action: "lead.update", entity: "Lead", entityId: id, before, after: { city: t("city"), campaignId, assignedToId: reassign, tags } });
  if (reassign !== lead.assignedToId) await leadAssigned(db, { organizationId: user.organizationId, leadId: id, toUserId: reassign, byUserId: user.id });
  redirect(`${back}?saved=1`);
}

export async function verifyAction(formData: FormData) {
  const user = await requirePermission("crm.view_all");
  try {
    await verifyActivity(db, { organizationId: user.organizationId, activityId: s(formData, "activityId"), verifierId: user.id });
    await audit(user, { action: "crm.verify_call", entity: "LeadActivity", entityId: s(formData, "activityId") });
  } catch (e) {
    if (e instanceof CrmError) return flash("/sales/activity", "error", e.message);
    throw e;
  }
  redirect("/sales/activity");
}

export async function setTargetAction(formData: FormData) {
  const user = await requirePermission("crm.view_all");
  const num = (k: string) => { const v = s(formData, k).trim(); return v === "" ? null : Number(v); };
  try {
    await setTarget(db, { organizationId: user.organizationId, userId: s(formData, "userId"), metric: s(formData, "metric"), daily: num("daily"), monthly: num("monthly"), actorId: user.id });
    await audit(user, { action: "crm.target", entity: "SalesTarget", after: { userId: s(formData, "userId"), metric: s(formData, "metric"), daily: num("daily"), monthly: num("monthly") } });
  } catch (e) {
    if (e instanceof CrmError) return flash("/sales/activity", "error", e.message);
    throw e;
  }
  redirect("/sales/activity?msg=Target%20saved");
}

export async function saveListAction(formData: FormData) {
  const user = await requirePermission("crm.view");
  const filters = cleanFilters({
    q: s(formData, "q"), stageNames: formData.getAll("stageNames").map(String), source: s(formData, "source"), campaignId: s(formData, "campaignId"), assignedTo: s(formData, "assignedTo"),
    tag: s(formData, "tag"), priority: s(formData, "priority"), minValue: s(formData, "minValue"), followUp: s(formData, "followUp"), noContactDays: s(formData, "noContactDays"), openOnly: formData.get("openOnly") === "on",
  });
  try {
    const l = await saveSmartList(db, { organizationId: user.organizationId, ownerId: user.id, name: s(formData, "name"), filters, shared: formData.get("shared") === "on" });
    await audit(user, { action: "smartlist.save", entity: "SmartList", entityId: l.id, after: { name: l.name, shared: l.shared } });
    redirect(`/leads/lists?list=${l.id}`);
  } catch (e) {
    if (e instanceof CrmError) return flash("/leads/lists", "error", e.message);
    throw e;
  }
}

export async function deleteListAction(formData: FormData) {
  const user = await requirePermission("crm.view");
  try {
    await deleteSmartList(db, { organizationId: user.organizationId, ownerId: user.id, id: s(formData, "id") });
    await audit(user, { action: "smartlist.delete", entity: "SmartList", entityId: s(formData, "id") });
  } catch (e) {
    if (e instanceof CrmError) return flash("/leads/lists", "error", e.message);
    throw e;
  }
  redirect("/leads/lists");
}

export async function saveCampaignAction(formData: FormData) {
  const user = await requirePermission("crm.view_all");
  try {
    const id = await saveCampaign(db, {
      organizationId: user.organizationId, id: s(formData, "id") || undefined, name: s(formData, "name"), channel: s(formData, "channel"), status: s(formData, "status"),
      budget: s(formData, "budget").trim() || null, currency: s(formData, "currency"), startDate: s(formData, "startDate") || null, endDate: s(formData, "endDate") || null, notes: s(formData, "notes"), actorId: user.id,
    });
    await audit(user, { action: "campaign.save", entity: "Campaign", entityId: id, after: { name: s(formData, "name"), status: s(formData, "status") } });
  } catch (e) {
    if (e instanceof CrmError) return flash("/campaigns", "error", e.message);
    throw e;
  }
  redirect("/campaigns?msg=Saved");
}
