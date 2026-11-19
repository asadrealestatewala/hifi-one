// Portfolio health: green, amber or red for every active project, with the reasons, so an owner sees trouble without asking
// the team. Signals: overdue tasks, the deadline, the last project update, and (only for people who may see costs) budget
// used. Free of Next.js imports so it can be tested against the database.
import type { PrismaClient, Prisma } from "@prisma/client";
import { projectProfitability } from "./project-finance";

type Db = PrismaClient;
const DAY = 86_400_000;
export type Health = "RED" | "AMBER" | "GREEN" | "PAUSED";
export const STALE_UPDATE_DAYS = 14;

export type HealthInput = {
  status: string; today: string; deadline: string | null; createdOn: string;
  openTasks: number; overdueTasks: number; progress: number; lastUpdate: string | null; budgetUsedPct: number | null;
};

const daysBetween = (a: string, b: string) => Math.round((new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / DAY);

// Red: the deadline has passed with work open, three or more tasks overdue (or over a quarter of the open ones), or over budget.
// Amber: anything overdue, the deadline within 7 days with under 80% done, 80% or more of the budget used, or no update for
// 14 days. On hold projects are shown as paused, not judged.
export function projectHealth(i: HealthInput): { health: Health; reasons: string[] } {
  if (i.status === "ON_HOLD") return { health: "PAUSED", reasons: ["On hold"] };
  const red: string[] = [], amber: string[] = [];
  const left = i.deadline ? daysBetween(i.today, i.deadline) : null;
  if (left !== null && left < 0 && i.progress < 100) red.push(`Deadline passed ${-left} day${left === -1 ? "" : "s"} ago`);
  else if (left !== null && left <= 7 && i.progress < 80) amber.push(`Deadline in ${left} day${left === 1 ? "" : "s"}, ${i.progress}% done`);
  if (i.overdueTasks >= 3 || (i.openTasks > 0 && i.overdueTasks / i.openTasks > 0.25 && i.overdueTasks > 0)) red.push(`${i.overdueTasks} task${i.overdueTasks === 1 ? "" : "s"} overdue`);
  else if (i.overdueTasks > 0) amber.push(`${i.overdueTasks} task${i.overdueTasks === 1 ? "" : "s"} overdue`);
  if (i.budgetUsedPct !== null) {
    if (i.budgetUsedPct > 100) red.push(`Over budget (${i.budgetUsedPct}% used)`);
    else if (i.budgetUsedPct >= 80) amber.push(`${i.budgetUsedPct}% of budget used`);
  }
  const quiet = i.lastUpdate ? daysBetween(i.lastUpdate, i.today) : daysBetween(i.createdOn, i.today);
  if (quiet >= STALE_UPDATE_DAYS) amber.push(i.lastUpdate ? `No update for ${quiet} days` : "No update posted yet");
  if (red.length) return { health: "RED", reasons: [...red, ...amber] };
  if (amber.length) return { health: "AMBER", reasons: amber };
  return { health: "GREEN", reasons: [] };
}

export type ProjectHealthRow = { projectId: string; health: Health; reasons: string[]; overdueTasks: number; lastUpdate: string | null; budgetUsedPct: number | null };

// Health for the given open projects (Active or On hold). `withBudget` only for people with projects.costs.
export async function loadProjectHealth(db: Db, p: { organizationId: string; projects: { id: string; status: string; deadline: Date | null; createdAt: Date; budgetAmount: Prisma.Decimal | null }[]; today: string; withBudget: boolean }): Promise<Map<string, ProjectHealthRow>> {
  const open = p.projects.filter((x) => x.status === "ACTIVE" || x.status === "ON_HOLD");
  const ids = open.map((x) => x.id);
  if (!ids.length) return new Map();
  const start = new Date(`${p.today}T00:00:00.000Z`);
  const [all, overdue, done, openCount, updates] = await Promise.all([
    db.task.groupBy({ by: ["projectId"], where: { projectId: { in: ids }, parentId: null }, _count: { _all: true } }),
    db.task.groupBy({ by: ["projectId"], where: { projectId: { in: ids }, status: { not: "DONE" }, dueDate: { lt: start } }, _count: { _all: true } }),
    db.task.groupBy({ by: ["projectId"], where: { projectId: { in: ids }, parentId: null, status: "DONE" }, _count: { _all: true } }),
    db.task.groupBy({ by: ["projectId"], where: { projectId: { in: ids }, status: { not: "DONE" } }, _count: { _all: true } }),
    db.projectUpdate.groupBy({ by: ["projectId"], where: { organizationId: p.organizationId, projectId: { in: ids } }, _max: { createdAt: true } }),
  ]);
  const m = <T extends { projectId: string; _count: { _all: number } }>(rows: T[]) => new Map(rows.map((r) => [r.projectId, r._count._all]));
  const [cAll, cLate, cDone, cOpen] = [m(all), m(overdue), m(done), m(openCount)];
  const last = new Map(updates.map((u) => [u.projectId, u._max.createdAt]));
  // Budget used only for people who may see costs, and only where a budget was approved
  const budgets = new Map(await Promise.all(open.filter((x) => p.withBudget && x.budgetAmount && x.status === "ACTIVE").map(async (x) => {
    const f = await projectProfitability(db, p.organizationId, x.id);
    return [x.id, f.budgetUsedPct === null ? null : Number(f.budgetUsedPct)] as const;
  })));
  const out = new Map<string, ProjectHealthRow>();
  for (const x of open) {
    const budgetUsedPct = budgets.get(x.id) ?? null;
    const total = cAll.get(x.id) ?? 0;
    const lu = last.get(x.id);
    const lastUpdate = lu ? lu.toISOString().slice(0, 10) : null;
    const h = projectHealth({
      status: x.status, today: p.today, deadline: x.deadline ? x.deadline.toISOString().slice(0, 10) : null, createdOn: x.createdAt.toISOString().slice(0, 10),
      openTasks: cOpen.get(x.id) ?? 0, overdueTasks: cLate.get(x.id) ?? 0, progress: total ? Math.round(((cDone.get(x.id) ?? 0) / total) * 100) : 0, lastUpdate, budgetUsedPct,
    });
    out.set(x.id, { projectId: x.id, ...h, overdueTasks: cLate.get(x.id) ?? 0, lastUpdate, budgetUsedPct });
  }
  return out;
}

// One wording everywhere health shows (Projects list, project page, home screen, weekly digest)
export const HEALTH_LABEL: Record<Health, string> = { RED: "At risk", AMBER: "Watch", GREEN: "On track", PAUSED: "Paused" };
export const HEALTH_TONE: Record<Health, "danger" | "warning" | "success" | "neutral"> = { RED: "danger", AMBER: "warning", GREEN: "success", PAUSED: "neutral" };
