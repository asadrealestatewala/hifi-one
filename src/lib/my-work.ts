// One person's open work across every project, in the groups a person plans their day by: Overdue, Today,
// Next 7 days, Later and No due date, plus what they finished today. Subtasks assigned to the person count too,
// so this list and the My day counts always agree. Free of Next.js imports so it can be tested against the database.
import type { PrismaClient, Prisma } from "@prisma/client";
import { dayBounds } from "./daily-reports";

type Db = PrismaClient;

export const WORK_GROUPS = ["overdue", "today", "week", "later", "nodate"] as const;
export type WorkGroup = (typeof WORK_GROUPS)[number];
export const WORK_GROUP_LABEL: Record<WorkGroup | "done", string> = {
  overdue: "Overdue", today: "Today", week: "Next 7 days", later: "Later", nodate: "No due date", done: "Done today",
};

export type WorkRow = {
  id: string; title: string; status: string; priority: string; dueDate: Date | null;
  project: { id: string; name: string; number: string; status: string };
  parentTitle: string | null; // set when the row is a subtask
  openSubtasks: number;
  waiting: number; // tasks this one waits for that are not Done yet
};
export type WorkSection = { key: WorkGroup | "done"; count: number; rows: WorkRow[] };

const DAY = 86_400_000;
// Due dates are stored as the calendar date at 00:00 UTC, so the groups compare against the person's local date the same way.
export function groupRanges(today: string): Record<WorkGroup, Prisma.DateTimeNullableFilter | null> {
  const t = new Date(`${today}T00:00:00.000Z`).getTime();
  const at = (days: number) => new Date(t + days * DAY);
  return {
    overdue: { lt: at(0) },
    today: { gte: at(0), lt: at(1) },
    week: { gte: at(1), lt: at(7) },
    later: { gte: at(7) },
    nodate: null,
  };
}

// The group one due date falls in. Pure, so the boundaries are testable without a database.
export function workGroupOf(dueDate: Date | null, today: string): WorkGroup {
  if (!dueDate) return "nodate";
  const d = dueDate.toISOString().slice(0, 10);
  if (d < today) return "overdue";
  if (d === today) return "today";
  const diff = Math.round((new Date(`${d}T00:00:00Z`).getTime() - new Date(`${today}T00:00:00Z`).getTime()) / DAY);
  return diff < 7 ? "week" : "later";
}

const ORDER: Prisma.TaskOrderByWithRelationInput[] = [{ dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }, { id: "asc" }];

export async function loadMyWork(
  db: Db,
  p: { organizationId: string; userId: string; today: string; timeZone: string; perGroup?: number; only?: { group: WorkGroup; skip: number; take: number } },
): Promise<{ sections: WorkSection[]; open: number }> {
  const per = p.perGroup ?? 25;
  const mine: Prisma.TaskWhereInput = { assigneeId: p.userId, project: { organizationId: p.organizationId, status: { not: "CANCELLED" }, archivedAt: null } };
  const open: Prisma.TaskWhereInput = { ...mine, status: { not: "DONE" } };
  const ranges = groupRanges(checkDate(p.today));
  const whereFor = (g: WorkGroup): Prisma.TaskWhereInput => ({ ...open, dueDate: ranges[g] ?? null });
  const done = dayBounds(p.today, p.timeZone);
  const doneWhere: Prisma.TaskWhereInput = { ...mine, status: "DONE", completedAt: { gte: done.gte, lt: done.lt } };
  const keys: (WorkGroup | "done")[] = p.only ? [p.only.group] : [...WORK_GROUPS, "done"];
  const include = { project: { select: { id: true, name: true, number: true, status: true } } } as const;
  const loaded = await Promise.all(keys.map(async (k) => {
    const where = k === "done" ? doneWhere : whereFor(k);
    const [rows, count] = await Promise.all([
      db.task.findMany({ where, include, orderBy: k === "done" ? [{ completedAt: "desc" }, { id: "asc" }] : ORDER, skip: p.only?.skip ?? 0, take: p.only?.take ?? per }),
      db.task.count({ where }),
    ]);
    return { key: k, rows, count };
  }));
  const all = loaded.flatMap((s) => s.rows);
  // One query each for parent titles, open subtasks and the tasks a row waits for
  const parentIds = [...new Set(all.map((t) => t.parentId).filter(Boolean) as string[])];
  const waitIds = [...new Set(all.flatMap((t) => t.blockedBy))];
  const [parents, subs, waits, openCount] = await Promise.all([
    parentIds.length ? db.task.findMany({ where: { id: { in: parentIds } }, select: { id: true, title: true } }) : [],
    all.length ? db.task.groupBy({ by: ["parentId"], where: { parentId: { in: all.map((t) => t.id) }, status: { not: "DONE" } }, _count: { _all: true } }) : [],
    waitIds.length ? db.task.findMany({ where: { id: { in: waitIds }, status: { not: "DONE" } }, select: { id: true } }) : [],
    db.task.count({ where: open }),
  ]);
  const parentTitle = new Map(parents.map((x) => [x.id, x.title]));
  const subCount = new Map(subs.map((s) => [s.parentId, s._count._all]));
  const notDone = new Set(waits.map((w) => w.id));
  const sections = loaded.map((s) => ({
    key: s.key, count: s.count,
    rows: s.rows.map((t): WorkRow => ({
      id: t.id, title: t.title, status: t.status, priority: t.priority, dueDate: t.dueDate, project: t.project,
      parentTitle: t.parentId ? parentTitle.get(t.parentId) ?? null : null,
      openSubtasks: subCount.get(t.id) ?? 0,
      waiting: t.blockedBy.filter((id) => notDone.has(id)).length,
    })),
  }));
  return { sections, open: openCount };
}

function checkDate(d: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error("today must be YYYY-MM-DD");
  return d;
}
