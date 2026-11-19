"use server";

import { revalidatePath } from "next/cache";
import { audit, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { TimerError, currentTimer, discardTimer, startTimer, stopTimer, type RunningTimer } from "@/lib/task-timer";

export type TimerResult = { ok: true; timer: RunningTimer | null; message?: string } | { ok: false; error: string };

const zone = async (organizationId: string) =>
  (await db.companyProfile.findFirst({ where: { organizationId, isDefault: true }, select: { timezone: true } }))?.timezone ?? "UTC";
const fail = (e: unknown): TimerResult => {
  if (e instanceof TimerError) return { ok: false, error: e.message };
  throw e;
};

// The running timer, for the bar at the top of every screen and the task panel.
export async function currentTimerAction(): Promise<TimerResult> {
  const user = await requirePermission("tasks.edit");
  return { ok: true, timer: await currentTimer(db, { organizationId: user.organizationId, userId: user.id }) };
}

export async function startTimerAction(taskId: string): Promise<TimerResult> {
  const user = await requirePermission("tasks.edit");
  try {
    const t = await startTimer(db, { organizationId: user.organizationId, userId: user.id, taskId: String(taskId) });
    await audit(user, { action: "timer.start", entity: "Task", entityId: t.taskId });
  } catch (e) { return fail(e); }
  return { ok: true, timer: await currentTimer(db, { organizationId: user.organizationId, userId: user.id }) };
}

// Saves the time to the task's project time log. `hours` is optional: left empty, the measured time is used.
export async function stopTimerAction(hours: string | null, note: string | null): Promise<TimerResult> {
  const user = await requirePermission("tasks.edit");
  let r;
  try {
    r = await stopTimer(db, { organizationId: user.organizationId, userId: user.id, hours, note, timeZone: await zone(user.organizationId) });
  } catch (e) { return fail(e); }
  await audit(user, { action: "time.log", entity: "TimeEntry", entityId: r.entry.id, after: { hours: r.entry.hours.toString(), workDate: r.entry.workDate, fromTimer: true, measured: r.measured } });
  revalidatePath(`/projects/${r.projectId}`);
  return { ok: true, timer: null, message: `Saved ${Number(r.entry.hours)} h to the time log.` };
}

export async function discardTimerAction(): Promise<TimerResult> {
  const user = await requirePermission("tasks.edit");
  try {
    await discardTimer(db, { organizationId: user.organizationId, userId: user.id });
  } catch (e) { return fail(e); }
  await audit(user, { action: "timer.discard", entity: "TaskTimer", entityId: user.id });
  return { ok: true, timer: null, message: "Timer discarded. Nothing was saved." };
}
