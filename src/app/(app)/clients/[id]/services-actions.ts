"use server";

import { redirect } from "next/navigation";
import { audit, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { EngagementError, createEngagement, logUsage, setClientType, setEngagementStatus, setProjectManager, setSupportManager, voidUsage } from "@/lib/engagements";

const back = (clientId: string, q: string) => redirect(`/clients/${clientId}?tab=services&${q}`);

export async function saveClientProfile(formData: FormData): Promise<void> {
  const user = await requirePermission("clients.edit");
  const clientId = String(formData.get("clientId") ?? "");
  try {
    await setClientType(db, { organizationId: user.organizationId, clientId, clientType: String(formData.get("clientType") ?? "") });
    await setProjectManager(db, { organizationId: user.organizationId, clientId, userId: String(formData.get("projectManagerId") ?? "") || null });
    // The support manager select only appears for SaaS customers; leave it alone when the form did not send it
    if (formData.has("supportManagerId")) await setSupportManager(db, { organizationId: user.organizationId, clientId, userId: String(formData.get("supportManagerId") ?? "") || null });
    await audit(user, { action: "client.profile", entity: "Client", entityId: clientId, after: { clientType: formData.get("clientType"), projectManagerId: formData.get("projectManagerId") || null, ...(formData.has("supportManagerId") ? { supportManagerId: formData.get("supportManagerId") || null } : {}) } });
  } catch (e) {
    if (e instanceof EngagementError) back(clientId, `error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  back(clientId, "saved=1");
}

export async function addEngagement(formData: FormData): Promise<void> {
  const user = await requirePermission("clients.edit");
  const clientId = String(formData.get("clientId") ?? "");
  const s = (k: string) => String(formData.get(k) ?? "").trim();
  const kind = s("kind") === "SINGLE_SERVICE" ? "SINGLE_SERVICE" : "RETAINER";
  try {
    const e = await createEngagement(db, {
      organizationId: user.organizationId, clientId, actorId: user.id, kind, startDate: s("startDate"), notes: s("notes"),
      planId: s("planId") || null, name: s("name"), interval: s("interval") || undefined, amount: s("amount") || undefined,
      serviceKey: s("serviceKey"), quantity: Number(s("quantity") || 0), unitPrice: s("unitPrice"),
    });
    await audit(user, { action: "engagement.create", entity: "Engagement", entityId: e.id, after: { clientId, kind, name: e.name, amount: e.amount.toString(), currency: e.currency, interval: e.interval } });
  } catch (e) {
    if (e instanceof EngagementError) back(clientId, `error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  back(clientId, "saved=1");
}

export async function changeEngagementStatus(formData: FormData): Promise<void> {
  const user = await requirePermission("clients.edit");
  const clientId = String(formData.get("clientId") ?? "");
  const engagementId = String(formData.get("engagementId") ?? "");
  const status = String(formData.get("status") ?? "");
  try {
    await setEngagementStatus(db, { organizationId: user.organizationId, engagementId, status });
    await audit(user, { action: "engagement.status", entity: "Engagement", entityId: engagementId, after: { status } });
  } catch (e) {
    if (e instanceof EngagementError) back(clientId, `error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  back(clientId, "saved=1");
}

export async function recordUsage(formData: FormData): Promise<void> {
  const user = await requirePermission("clients.edit");
  const clientId = String(formData.get("clientId") ?? "");
  const engagementId = String(formData.get("engagementId") ?? "");
  try {
    const u = await logUsage(db, { organizationId: user.organizationId, engagementId, key: String(formData.get("key") ?? ""), quantity: Number(formData.get("quantity") || 0), note: String(formData.get("note") ?? ""), actorId: user.id });
    await audit(user, { action: "engagement.usage", entity: "Engagement", entityId: engagementId, after: { key: u.key, quantity: u.quantity, period: u.period } });
  } catch (e) {
    if (e instanceof EngagementError) back(clientId, `error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  back(clientId, "saved=1");
}

export async function voidUsageEntry(formData: FormData): Promise<void> {
  const user = await requirePermission("clients.edit");
  const clientId = String(formData.get("clientId") ?? "");
  const usageId = String(formData.get("usageId") ?? "");
  try {
    await voidUsage(db, { organizationId: user.organizationId, usageId });
    await audit(user, { action: "engagement.usage_void", entity: "QuotaUsage", entityId: usageId });
  } catch (e) {
    if (e instanceof EngagementError) back(clientId, `error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  back(clientId, "saved=1");
}
