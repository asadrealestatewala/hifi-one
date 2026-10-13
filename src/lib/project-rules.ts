// Pure project rules, shared by the UI and the server actions.
export const TASK_STATUSES = ["TODO", "IN_PROGRESS", "REVIEW", "DONE"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const STATUS_LABEL: Record<TaskStatus, string> = {
  TODO: "To do", IN_PROGRESS: "In progress", REVIEW: "In review", DONE: "Done",
};

// One consistent rule everywhere: progress is the share of tasks that are Done.
// Subtasks are steps inside a task, so only top-level tasks count.
export function projectProgress(all: { status: string; parentId?: string | null }[]): number {
  const tasks = all.filter((t) => !t.parentId);
  if (tasks.length === 0) return 0;
  return Math.round((tasks.filter((t) => t.status === "DONE").length / tasks.length) * 100);
}

// A project cannot be completed by hand while tasks remain open.
export function canCompleteProject(tasks: { status: string }[]): { ok: true } | { ok: false; reason: string } {
  if (tasks.length === 0) return { ok: false, reason: "Add and finish at least one task before completing the project." };
  const open = tasks.filter((t) => t.status !== "DONE").length;
  return open === 0 ? { ok: true } : { ok: false, reason: `${open} task${open === 1 ? " is" : "s are"} not done yet.` };
}

export function isOverdue(t: { status: string; dueDate: Date | null }, now = new Date()): boolean {
  return t.status !== "DONE" && t.dueDate !== null && t.dueDate.getTime() < now.getTime();
}
