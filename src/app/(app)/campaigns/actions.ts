"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { audit, requirePermission } from "@/lib/auth";
import { SpendError, addSpend, deleteSpend } from "@/lib/campaign-performance";
import { CampaignError, linkProject, saveCampaignRecord, setCampaignArchived, setCampaignClients, setCampaignTeam } from "@/lib/campaigns";
import { db } from "@/lib/db";
import { notifyMany } from "@/lib/notifications";

const s = (f: FormData, k: string) => String(f.get(k) ?? "");
const input = (f: FormData) => ({
  name: s(f, "name"), categoryId: s(f, "categoryId") || null, description: s(f, "description"), objectives: s(f, "objectives"), status: s(f, "status") || "ACTIVE",
  channel: s(f, "channel") || "OTHER", budget: s(f, "budget"), currency: s(f, "currency") || "USD", startDate: s(f, "startDate") || null, endDate: s(f, "endDate") || null,
  ownerId: s(f, "ownerId") || null, notes: s(f, "notes"),
});
const fail = (to: string, m: string) => redirect(`${to}${to.includes("?") ? "&" : "?"}error=${encodeURIComponent(m)}`);

export async function createCampaignAction(formData: FormData): Promise<void> {
  const user = await requirePermission("campaigns.manage");
  let id: string;
  try {
    const c = await saveCampaignRecord(db, { organizationId: user.organizationId, actorId: user.id, input: input(formData) });
    if (c.ownerId) await setCampaignTeam(db, { organizationId: user.organizationId, id: c.id, userIds: [] });
    await audit(user, { action: "campaign.create", entity: "Campaign", entityId: c.id, after: { code: c.code, name: c.name, categoryId: c.categoryId } });
    id = c.id;
  } catch (e) {
    if (e instanceof CampaignError) fail("/campaigns?new=1", e.message);
    throw e;
  }
  redirect(`/campaigns/${id}?msg=${encodeURIComponent("Campaign created.")}`);
}

export async function updateCampaignAction(formData: FormData): Promise<void> {
  const user = await requirePermission("campaigns.manage");
  const id = s(formData, "id");
  try {
    const c = await saveCampaignRecord(db, { organizationId: user.organizationId, actorId: user.id, id, input: input(formData) });
    if (c.ownerId) await setCampaignTeam(db, { organizationId: user.organizationId, id, userIds: (await db.campaignMember.findMany({ where: { campaignId: id } })).map((m) => m.userId) });
    await audit(user, { action: "campaign.update", entity: "Campaign", entityId: id, after: { name: c.name, status: c.status, categoryId: c.categoryId, ownerId: c.ownerId } });
  } catch (e) {
    if (e instanceof CampaignError) fail(`/campaigns/${id}`, e.message);
    throw e;
  }
  revalidatePath("/campaigns");
  redirect(`/campaigns/${id}?msg=${encodeURIComponent("Saved.")}`);
}

export async function campaignLinksAction(formData: FormData): Promise<void> {
  const user = await requirePermission("campaigns.manage");
  const id = s(formData, "id");
  const op = s(formData, "op");
  const org = user.organizationId;
  try {
    if (op === "team") {
      const r = await setCampaignTeam(db, { organizationId: org, id, userIds: formData.getAll("userIds").map(String) });
      await audit(user, { action: "campaign.team", entity: "Campaign", entityId: id, after: r });
      const c = await db.campaign.findUniqueOrThrow({ where: { id }, select: { name: true } });
      await notifyMany(db, r.added.filter((u) => u !== user.id), { kind: "campaign.assigned", title: `You were added to the campaign ${c.name}`, link: `/campaigns/${id}`, dedupeKey: `campaign-team:${id}:${Date.now()}` });
    } else if (op === "clients") {
      await setCampaignClients(db, { organizationId: org, id, clientIds: formData.getAll("clientIds").map(String) });
      await audit(user, { action: "campaign.clients", entity: "Campaign", entityId: id, after: { clients: formData.getAll("clientIds").length } });
    } else if (op === "link_project" || op === "unlink_project") {
      const projectId = s(formData, "projectId");
      await linkProject(db, { organizationId: org, projectId, campaignId: op === "link_project" ? id : null });
      await audit(user, { action: `campaign.${op}`, entity: "Campaign", entityId: id, after: { projectId } });
    } else if (op === "archive" || op === "restore") {
      await setCampaignArchived(db, { organizationId: org, id, archived: op === "archive" });
      await audit(user, { action: `campaign.${op}`, entity: "Campaign", entityId: id });
    }
  } catch (e) {
    if (e instanceof CampaignError) fail(`/campaigns/${id}`, e.message);
    throw e;
  }
  revalidatePath(`/campaigns/${id}`);
  redirect(`/campaigns/${id}?msg=${encodeURIComponent("Saved.")}`);
}

export async function spendAction(formData: FormData): Promise<void> {
  const user = await requirePermission("campaigns.manage");
  const id = s(formData, "id");
  try {
    if (s(formData, "op") === "delete") {
      await deleteSpend(db, { organizationId: user.organizationId, id: s(formData, "spendId") });
      await audit(user, { action: "campaign.spend_delete", entity: "Campaign", entityId: id, after: { spendId: s(formData, "spendId") } });
    } else {
      const e = await addSpend(db, { organizationId: user.organizationId, campaignId: id, actorId: user.id, date: s(formData, "date"), platform: s(formData, "platform"), amount: s(formData, "amount"), currency: s(formData, "currency") || "USD", impressions: s(formData, "impressions"), clicks: s(formData, "clicks"), results: s(formData, "results"), note: s(formData, "note") });
      await audit(user, { action: "campaign.spend_add", entity: "Campaign", entityId: id, after: { spendId: e.id, amount: e.amount.toString(), currency: e.currency, platform: e.platform } });
    }
  } catch (e) {
    if (e instanceof SpendError) fail(`/campaigns/${id}`, e.message);
    throw e;
  }
  revalidatePath(`/campaigns/${id}`);
  redirect(`/campaigns/${id}?msg=${encodeURIComponent("Saved.")}#performance`);
}
