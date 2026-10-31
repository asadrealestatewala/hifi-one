"use server";

import { revalidatePath } from "next/cache";
import { audit, requirePermission } from "@/lib/auth";
import { CaptureError, createSource, rotateKey } from "@/lib/lead-capture";
import { db } from "@/lib/db";

export type SourceState = { error?: string; key?: string; name?: string };

const s = (f: FormData, k: string) => String(f.get(k) ?? "");

// The key is returned once, in the response to this action, and never stored in readable form or put in an address.
export async function createSourceAction(_prev: SourceState, formData: FormData): Promise<SourceState> {
  const user = await requirePermission("leadsources.manage");
  try {
    const { source, key } = await createSource(db, {
      organizationId: user.organizationId, name: s(formData, "name"), campaignId: s(formData, "campaignId") || null, assignMode: s(formData, "assignMode") || "ROUND_ROBIN",
      assigneeIds: formData.getAll("assigneeIds").map(String), allowedOrigins: s(formData, "allowedOrigins"),
    });
    await audit(user, { action: "leadsource.create", entity: "LeadSource", entityId: source.id, after: { name: source.name, mode: source.assignMode } });
    revalidatePath("/settings/lead-sources");
    return { key, name: source.name };
  } catch (e) {
    if (e instanceof CaptureError) return { error: e.message };
    throw e;
  }
}

export async function rotateKeyAction(_prev: SourceState, formData: FormData): Promise<SourceState> {
  const user = await requirePermission("leadsources.manage");
  const id = s(formData, "id");
  try {
    const key = await rotateKey(db, { organizationId: user.organizationId, id });
    await audit(user, { action: "leadsource.rotate_key", entity: "LeadSource", entityId: id });
    return { key, name: s(formData, "name") };
  } catch (e) {
    if (e instanceof CaptureError) return { error: e.message };
    throw e;
  }
}

export async function toggleSourceAction(formData: FormData): Promise<void> {
  const user = await requirePermission("leadsources.manage");
  const id = s(formData, "id");
  const active = s(formData, "active") === "1";
  const r = await db.leadSource.updateMany({ where: { id, organizationId: user.organizationId }, data: { active } });
  if (r.count > 0) await audit(user, { action: active ? "leadsource.enable" : "leadsource.disable", entity: "LeadSource", entityId: id });
  revalidatePath("/settings/lead-sources");
}
