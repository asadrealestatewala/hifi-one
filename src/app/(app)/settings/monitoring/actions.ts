"use server";

import { redirect } from "next/navigation";
import { audit, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { MonitorError, createEnrollmentCode, purgeMonitoring, revokeDevice, savePolicy } from "@/lib/monitoring";
import { defaultStorage } from "@/lib/storage";

const s = (f: FormData, k: string) => String(f.get(k) ?? "");
const back = (kind: "error" | "msg", m: string) => redirect(`/settings/monitoring?${kind}=${encodeURIComponent(m)}`);

export async function savePolicyAction(formData: FormData) {
  const user = await requirePermission("monitoring.configure");
  try {
    const before = await db.monitoringPolicy.findUnique({ where: { organizationId: user.organizationId } });
    const p = await savePolicy(db, {
      organizationId: user.organizationId, actorId: user.id,
      patch: {
        enabled: formData.get("enabled") === "on", policyText: s(formData, "policyText"), trackActivity: formData.get("trackActivity") === "on", trackApps: formData.get("trackApps") === "on", screenshots: formData.get("screenshots") === "on",
        screenshotIntervalMin: Number(s(formData, "screenshotIntervalMin")), idleThresholdMin: Number(s(formData, "idleThresholdMin")), timezone: s(formData, "timezone").trim(), workStart: s(formData, "workStart"), workEnd: s(formData, "workEnd"),
        workDays: formData.getAll("workDays").map(String).sort().join(","), retentionDays: Number(s(formData, "retentionDays")),
      },
    });
    await db.settingChange.create({ data: { organizationId: user.organizationId, section: "monitoring_policy", actorId: user.id, before: before ? { version: before.version, enabled: before.enabled, screenshots: before.screenshots, trackApps: before.trackApps } : undefined, after: { version: p.version, enabled: p.enabled, screenshots: p.screenshots, trackApps: p.trackApps } } });
    await audit(user, { action: "monitoring.policy_save", entity: "MonitoringPolicy", after: { version: p.version, enabled: p.enabled } });
  } catch (e) {
    if (e instanceof MonitorError) return back("error", e.message);
    throw e;
  }
  back("msg", "Policy saved. If what is collected changed, everyone is asked to accept the new version before anything more is recorded.");
}

export async function categoryAction(formData: FormData) {
  const user = await requirePermission("monitoring.configure");
  const op = s(formData, "op");
  if (op === "add") {
    const pattern = s(formData, "pattern").trim().slice(0, 60);
    const category = s(formData, "category");
    if (!pattern || !["PRODUCTIVE", "NEUTRAL", "UNPRODUCTIVE"].includes(category)) return back("error", "Enter an application name and a category.");
    await db.appCategory.upsert({ where: { organizationId_pattern: { organizationId: user.organizationId, pattern } }, update: { category }, create: { organizationId: user.organizationId, pattern, category } });
    await audit(user, { action: "monitoring.category_set", entity: "AppCategory", after: { pattern, category } });
  } else if (op === "delete") {
    await db.appCategory.deleteMany({ where: { id: s(formData, "id"), organizationId: user.organizationId } });
  }
  redirect("/settings/monitoring");
}

export async function revokeAction(formData: FormData) {
  const user = await requirePermission("monitoring.configure");
  try {
    await revokeDevice(db, { organizationId: user.organizationId, deviceId: s(formData, "id") });
    await audit(user, { action: "monitoring.device_revoke", entity: "MonitorDevice", entityId: s(formData, "id") });
  } catch (e) {
    if (e instanceof MonitorError) return back("error", e.message);
    throw e;
  }
  back("msg", "Device revoked. It can no longer send anything.");
}

export async function purgeAction() {
  const user = await requirePermission("monitoring.configure");
  const r = await purgeMonitoring(db, defaultStorage());
  await audit(user, { action: "monitoring.purge", entity: "MonitoringPolicy", after: r });
  back("msg", `Removed ${r.screenshots} expired screenshots, ${r.buckets} old activity records and ${r.appUsage} old application records.`);
}

export type CodeState = { code?: string; error?: string; person?: string };
export async function enrollCodeAction(_prev: CodeState, formData: FormData): Promise<CodeState> {
  const user = await requirePermission("monitoring.configure");
  try {
    const userId = s(formData, "userId");
    const code = await createEnrollmentCode(db, { organizationId: user.organizationId, userId, createdById: user.id });
    const who = await db.user.findUnique({ where: { id: userId }, select: { name: true } });
    await audit(user, { action: "monitoring.enrol_code", entity: "User", entityId: userId });
    return { code, person: who?.name };
  } catch (e) {
    if (e instanceof MonitorError) return { error: e.message };
    throw e;
  }
}
