// Deadline alerts that cannot wait for the daily jobs: checked every minute by the server (src/instrumentation.ts).
// - 2 hours before a task's deadline, its assignee is told how much time is left.
// - At the deadline, the assignee is told time is up and the project manager gets a "late" alert.
// Each alert carries the deadline in its dedupe key, so it goes out once per deadline, and again if the task is given a
// new deadline. Several servers or a restart are safe. Tasks already more than a day late are left to the daily jobs.
import type { PrismaClient } from "@prisma/client";
import { notifyMany } from "./notifications";
import { getCalendar } from "./working-calendar";
import { countdown, deadlineAt, deadlineText, ORANGE_MINUTES, spanText, type DeadlineCalendar } from "./task-deadline";

type Db = PrismaClient;
const MIN = 60_000;
const LINK = (projectId: string, taskId: string) => `/projects/${projectId}?task=${taskId}`;

export async function runTaskDeadlineAlerts(db: Db, opts: { now?: Date; organizationId?: string } = {}): Promise<{ soon: number; late: number }> {
  const now = opts.now ?? new Date();
  // Due dates are whole days; a day either side covers every time zone and the "last day late" window
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 2));
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 2));
  const tasks = await db.task.findMany({
    where: {
      assigneeId: { not: null }, status: { not: "DONE" }, dueDate: { gte: from, lt: to },
      project: { status: { in: ["ACTIVE", "ON_HOLD"] }, archivedAt: null, ...(opts.organizationId ? { organizationId: opts.organizationId } : {}) },
    },
    select: { id: true, title: true, dueDate: true, dueTime: true, assigneeId: true, projectId: true, project: { select: { name: true, organizationId: true, managerId: true } } },
  });
  const calendars = new Map<string, DeadlineCalendar>();
  const calendarOf = async (org: string) => {
    if (!calendars.has(org)) calendars.set(org, await getCalendar(db, org));
    return calendars.get(org)!;
  };
  let soon = 0, late = 0;
  const assigneeNames = new Map<string, string>();
  for (const t of tasks) {
    const cal = await calendarOf(t.project.organizationId);
    const at = deadlineAt(t.dueDate, t.dueTime, cal)!;
    const left = at.getTime() - now.getTime();
    const stamp = at.toISOString();
    if (left > 0 && left <= ORANGE_MINUTES * MIN) {
      soon++;
      await notifyMany(db, [t.assigneeId!], {
        kind: "task.due_soon", title: `${spanText(left)} left: ${t.title}`, body: `${t.project.name} · due ${deadlineText(at, cal.timezone, now)}`,
        link: LINK(t.projectId, t.id), dedupeKey: `task-2h:${t.id}:${stamp}`,
      });
    } else if (left <= 0 && left > -24 * 60 * MIN) {
      late++;
      await notifyMany(db, [t.assigneeId!], {
        kind: "task.overdue", title: `Time is up: ${t.title}`, body: `${t.project.name} · was due ${deadlineText(at, cal.timezone, now)}. Finish it or tell your project manager.`,
        link: LINK(t.projectId, t.id), dedupeKey: `task-late:${t.id}:${stamp}`,
      });
      if (t.project.managerId && t.project.managerId !== t.assigneeId) {
        if (!assigneeNames.has(t.assigneeId!)) assigneeNames.set(t.assigneeId!, (await db.user.findUnique({ where: { id: t.assigneeId! }, select: { name: true } }))?.name ?? "The assignee");
        await notifyMany(db, [t.project.managerId], {
          kind: "task.late", title: `Late: ${t.title}`, body: `${assigneeNames.get(t.assigneeId!)} · ${t.project.name} · ${countdown(at, now).text.toLowerCase()}`,
          link: LINK(t.projectId, t.id), dedupeKey: `task-late-pm:${t.id}:${stamp}`,
        });
      }
    }
  }
  return { soon, late };
}
