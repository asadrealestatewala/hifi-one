// Task timer: press Start on a task, Stop when done, and the time lands in the project's time log. One timer runs per person; starting
// another while one runs is refused, so time is never counted twice. Stopping saves the elapsed hours (rounded to the minute, which
// the person may correct first) as a TimeEntry through logTime, so the usual rules hold: on the project team, an open project, at most
// 24 hours on one day. The day is the one the timer started on, in the company's time zone. A timer that ran past a set limit must
// have its hours typed in before it is saved, so a forgotten timer never logs a whole night. Discarding removes the timer without
// saving. Separate from the attendance clock (WorkSession). Free of Next.js imports so it can be tested against the database.
import type { PrismaClient } from "@prisma/client";
import { ProjectError, logTime } from "./project-finance";

type Db = PrismaClient;

export const LONG_TIMER_HOURS = 10; // a timer that ran longer than this needs its hours confirmed by hand
export class TimerError extends Error {}

export type RunningTimer = { id: string; taskId: string; projectId: string; task: string; project: string; startedAt: string; note: string | null };

// Elapsed time as hours with two decimals, at least one minute's worth.
export function elapsedHours(startedAt: Date, now: Date): string {
  const minutes = Math.max(1, Math.round((now.getTime() - startedAt.getTime()) / 60_000));
  return (Math.round((minutes / 60) * 100) / 100).toFixed(2);
}

// The calendar date of an instant in a time zone (YYYY-MM-DD).
export const dateIn = (at: Date, timeZone: string) => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);

export async function currentTimer(db: Db, p: { organizationId: string; userId: string }): Promise<RunningTimer | null> {
  const t = await db.taskTimer.findFirst({ where: { organizationId: p.organizationId, userId: p.userId } });
  if (!t) return null;
  const task = await db.task.findFirst({ where: { id: t.taskId }, select: { title: true, project: { select: { name: true } } } });
  return { id: t.id, taskId: t.taskId, projectId: t.projectId, task: task?.title ?? "A deleted task", project: task?.project.name ?? "", startedAt: t.startedAt.toISOString(), note: t.note };
}

export async function startTimer(db: Db, p: { organizationId: string; userId: string; taskId: string; now?: Date }) {
  const task = await db.task.findFirst({
    where: { id: p.taskId, project: { organizationId: p.organizationId } },
    select: { id: true, title: true, projectId: true, status: true, project: { select: { managerId: true, status: true } } },
  });
  if (!task) throw new TimerError("Task not found.");
  const member = await db.projectMember.findUnique({ where: { projectId_userId: { projectId: task.projectId, userId: p.userId } }, select: { userId: true } });
  if (!member && task.project.managerId !== p.userId) throw new TimerError("Only people on the project can track time on its tasks.");
  if (task.project.status === "COMPLETED" || task.project.status === "CANCELLED") throw new TimerError("This project is closed.");
  if (task.status === "DONE") throw new TimerError("This task is done. Reopen it to track more time on it.");
  const running = await currentTimer(db, p);
  if (running) throw new TimerError(running.taskId === task.id ? "The timer is already running on this task." : `Your timer is running on "${running.task}". Stop it first.`);
  try {
    return await db.taskTimer.create({ data: { organizationId: p.organizationId, userId: p.userId, projectId: task.projectId, taskId: task.id, startedAt: p.now ?? new Date() } });
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") throw new TimerError("A timer is already running for you. Stop it first.");
    throw e;
  }
}

// Stops the person's timer and saves the time. `hours` is what they confirmed (optional unless the timer ran long).
export async function stopTimer(db: Db, p: { organizationId: string; userId: string; hours?: string | null; note?: string | null; now?: Date; timeZone: string }) {
  const now = p.now ?? new Date();
  const t = await db.taskTimer.findFirst({ where: { organizationId: p.organizationId, userId: p.userId } });
  if (!t) throw new TimerError("No timer is running.");
  const measured = elapsedHours(t.startedAt, now);
  const typed = p.hours?.trim() || null;
  if (!typed && Number(measured) > LONG_TIMER_HOURS) throw new TimerError(`The timer ran for ${measured} hours. Type the hours you actually worked before saving.`);
  const hours = typed ?? measured;
  const workDate = dateIn(t.startedAt, p.timeZone);
  // Claim the timer first so two Stop presses can never log the time twice; put it back if saving fails.
  const claimed = await db.taskTimer.deleteMany({ where: { id: t.id } });
  if (claimed.count === 0) throw new TimerError("This timer was already stopped.");
  try {
    const entry = await logTime(db, { organizationId: p.organizationId, projectId: t.projectId, userId: p.userId, taskId: t.taskId, workDate, hours, note: (p.note ?? t.note) || undefined, today: dateIn(now, p.timeZone) });
    return { entry, measured, taskId: t.taskId, projectId: t.projectId };
  } catch (e) {
    await db.taskTimer.create({ data: { id: t.id, organizationId: t.organizationId, userId: t.userId, projectId: t.projectId, taskId: t.taskId, startedAt: t.startedAt, note: t.note } }).catch(() => undefined);
    if (e instanceof ProjectError) throw new TimerError(e.message);
    throw e;
  }
}

export async function discardTimer(db: Db, p: { organizationId: string; userId: string }) {
  const r = await db.taskTimer.deleteMany({ where: { organizationId: p.organizationId, userId: p.userId } });
  if (r.count === 0) throw new TimerError("No timer is running.");
}
