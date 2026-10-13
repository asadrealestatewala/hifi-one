// Pure rules for subtasks, dependencies and recurring tasks.
export const RECURRENCES = ["DAILY", "WEEKLY", "MONTHLY"] as const;
export type Recurrence = (typeof RECURRENCES)[number];

// True when making `taskId` wait for `blockers` would create a loop (A waits for B waits for A, however long the chain).
export function wouldCycle(tasks: { id: string; blockedBy: string[] }[], taskId: string, blockers: string[]): boolean {
  const next = new Map(tasks.map((t) => [t.id, t.blockedBy]));
  next.set(taskId, blockers);
  const seen = new Set<string>();
  const stack = [...blockers];
  while (stack.length) {
    const id = stack.pop()!;
    if (id === taskId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...(next.get(id) ?? []));
  }
  return false;
}

// Tasks that still have to be Done before this one can start.
export const openBlockers = (blockedBy: string[], byId: Map<string, { status: string; title: string }>) =>
  blockedBy.map((id) => byId.get(id)).filter((t): t is { status: string; title: string } => !!t && t.status !== "DONE");

// Next due date for a recurring task, counted from the due date (or today when it had none). Month ends clamp: 31 Jan + 1 month = 28 or 29 Feb.
export function nextDue(from: Date | null, recurrence: Recurrence, today = new Date()): Date {
  const base = new Date(from ?? today);
  const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate()));
  if (recurrence === "DAILY") d.setUTCDate(d.getUTCDate() + 1);
  else if (recurrence === "WEEKLY") d.setUTCDate(d.getUTCDate() + 7);
  else {
    const day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + 1);
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(day, last));
  }
  return d;
}
