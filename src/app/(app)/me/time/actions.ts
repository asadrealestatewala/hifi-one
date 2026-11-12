"use server";

import { redirect } from "next/navigation";
import { audit, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { HrError } from "@/lib/hr";
import { breakEndAll, breakStartAll, clockInAll, clockOutAll } from "@/lib/clock";
import { MonitorError, acknowledge, disputeScreenshot, getPolicy, heartbeat, requestCorrection } from "@/lib/monitoring";

export type Beat = { ok: boolean; error?: string; recorded?: boolean; onBreak?: boolean; outsideHours?: boolean };
const s = (f: FormData, k: string) => String(f.get(k) ?? "");
const back = (kind: "error" | "msg", m: string) => redirect(`/me/time?${kind}=${encodeURIComponent(m)}`);

export async function acceptPolicy(formData: FormData) {
  const user = await requirePermission("monitoring.own");
  const policy = await getPolicy(db, user.organizationId);
  if (Number(s(formData, "version")) !== policy.version) return back("error", "The policy changed while you were reading it. Please read the new version.");
  await acknowledge(db, { userId: user.id, version: policy.version });
  await audit(user, { action: "monitoring.accept_policy", entity: "MonitoringPolicy", after: { version: policy.version } });
  redirect("/me/time");
}

export async function clock(formData: FormData) {
  const user = await requirePermission("monitoring.own");
  const op = s(formData, "op");
  try {
    if (op === "start") {
      const prof = await db.companyProfile.findFirst({ where: { organizationId: user.organizationId, isDefault: true } });
      const r = await clockInAll(db, { organizationId: user.organizationId, userId: user.id, timeZone: prof?.timezone ?? "UTC", workMode: "OFFICE", projectId: s(formData, "projectId") || null, note: s(formData, "note") });
      await audit(user, { action: "attendance.in", entity: "AttendanceRecord", entityId: r.attendance.id });
    } else if (op === "stop") { await clockOutAll(db, { userId: user.id }); await audit(user, { action: "attendance.out", entity: "AttendanceRecord" }); }
    else if (op === "breakStart") await breakStartAll(db, { userId: user.id });
    else if (op === "breakEnd") await breakEndAll(db, { userId: user.id });
  } catch (e) {
    if (e instanceof MonitorError || e instanceof HrError) return back("error", e.message);
    throw e;
  }
  redirect("/me/time");
}

// Called by the tracker in the page about every 30 seconds with counts only.
export async function beat(sessionId: string, active: number, idle: number, keys: number, clicks: number): Promise<Beat> {
  const user = await requirePermission("monitoring.own");
  try {
    const r = await heartbeat(db, { organizationId: user.organizationId, userId: user.id, sessionId, activeSeconds: active, idleSeconds: idle, keys, clicks });
    return { ok: true, ...r };
  } catch (e) {
    if (e instanceof MonitorError) return { ok: false, error: e.message };
    throw e;
  }
}

export async function correction(formData: FormData) {
  const user = await requirePermission("monitoring.own");
  try {
    await requestCorrection(db, { organizationId: user.organizationId, userId: user.id, day: s(formData, "day"), requestedMinutes: Math.round(Number(s(formData, "hours")) * 60), reason: s(formData, "reason"), today: new Date().toISOString().slice(0, 10) });
    await audit(user, { action: "monitoring.correction_request", entity: "TimesheetCorrection", after: { day: s(formData, "day") } });
  } catch (e) {
    if (e instanceof MonitorError) return back("error", e.message);
    throw e;
  }
  back("msg", "Correction requested. HR will review it.");
}

export async function dispute(formData: FormData) {
  const user = await requirePermission("monitoring.own");
  try {
    await disputeScreenshot(db, { organizationId: user.organizationId, userId: user.id, id: s(formData, "id"), note: s(formData, "note") });
    await audit(user, { action: "monitoring.dispute_screenshot", entity: "Screenshot", entityId: s(formData, "id") });
  } catch (e) {
    if (e instanceof MonitorError) return back("error", e.message);
    throw e;
  }
  back("msg", "Thank you. HR will review the screenshot you flagged.");
}
