"use server";

import { redirect } from "next/navigation";
import { audit, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { backfillLeadKeys, getPolicy, savePolicy, type DupMode } from "@/lib/lead-duplicates";

const BASE = "/settings/duplicates";
const flash = (kind: "error" | "ok", m: string, extra = ""): never => redirect(`${BASE}?${kind}=${encodeURIComponent(m)}${extra}`);

export async function saveDuplicatePolicy(formData: FormData): Promise<void> {
  // Super Admin only: the permission is held by that role alone, and the role is checked again here
  const user = await requirePermission("crm.duplicates");
  if (!user.roleKeys.includes("SUPER_ADMIN")) redirect("/forbidden");
  const before = await getPolicy(db, user.organizationId);
  const next = { mode: String(formData.get("mode") ?? "") as DupMode, defaultCountry: String(formData.get("defaultCountry") ?? "") };
  try { await savePolicy(db, user.organizationId, next); } catch (e) { return flash("error", e instanceof Error ? e.message : "Could not save."); }
  await audit(user, { action: "crm.duplicates.policy", entity: "CrmSettings", entityId: user.organizationId, before, after: next });
  return flash("ok", "Saved.");
}

// Gives every existing lead its claim on its phone and email, oldest first. Nothing is deleted or edited.
export async function protectExistingLeads(): Promise<void> {
  const user = await requirePermission("crm.duplicates");
  if (!user.roleKeys.includes("SUPER_ADMIN")) redirect("/forbidden");
  const r = await backfillLeadKeys(db, user.organizationId);
  await audit(user, { action: "crm.duplicates.backfill", entity: "CrmSettings", entityId: user.organizationId, after: r });
  return flash("ok", `${r.leads} leads checked, ${r.claimsAdded} phone and email claims recorded, ${r.leftUnclaimed} left unclaimed because an older lead already holds them (see the report).`, "&scan=1");
}
