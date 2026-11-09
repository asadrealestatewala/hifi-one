"use server";

import { redirect } from "next/navigation";
import { audit, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { getQuestSettings } from "@/lib/crm-contacts";
import { readFields, readHolidays, type QuestSettingsData } from "@/lib/quest";

const flash = (kind: "error" | "ok", m: string): never => redirect(`/settings/quest?${kind}=${encodeURIComponent(m)}`);

export async function saveQuestSettings(formData: FormData): Promise<void> {
  // Super Admin only: the permission is held by that role alone, and the role is checked again here
  const user = await requirePermission("crm.quest_settings");
  if (!user.roleKeys.includes("SUPER_ADMIN")) redirect("/forbidden");
  const org = user.organizationId;
  const before = await getQuestSettings(db, org);
  const s = (k: string) => String(formData.get(k) ?? "");
  let next: QuestSettingsData;
  try {
    const roles = await db.role.findMany({ where: { organizationId: org }, select: { key: true } });
    const roleCfg: QuestSettingsData["roles"] = {};
    for (const r of roles) { const c = readFields((k) => s(`r:${r.key}:${k}`)); if (Object.keys(c).length) roleCfg[r.key] = c; }
    next = { base: readFields(s), roles: roleCfg, holidays: readHolidays(s("holidays")) };
  } catch (e) { return flash("error", e instanceof Error ? e.message : "Could not save."); }
  await db.questSettings.upsert({ where: { organizationId: org }, create: { organizationId: org, config: next }, update: { config: next } });
  await db.settingChange.create({ data: { organizationId: org, section: "quest_settings", actorId: user.id, before, after: next } });
  await audit(user, { action: "crm.quest.settings", entity: "QuestSettings", entityId: org, before, after: next });
  return flash("ok", "Saved. The new rules apply to every quest card straight away.");
}
