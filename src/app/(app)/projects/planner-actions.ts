"use server";

import { revalidatePath } from "next/cache";
import { audit, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { taskAssigned } from "@/lib/events";
import { notify } from "@/lib/notifications";
import { planTask, type PlanMove } from "@/lib/planner";
import { readWorkbook } from "@/lib/spreadsheet";
import { TaskError } from "@/lib/tasks";
import { PLAN_MAX_LINES, linesFromLastWeek, linesFromSheet, loadPlanContext, saveWeekPlan, type LineError, type PlanLine, type Skipped } from "@/lib/week-plan";

export type PlanResult = { ok: true } | { ok: false; error: string };

// The weekly planner's drag and drop (and its keyboard "Move to" menu). Rules live in planTask; this checks the permission,
// audits the move, tells the person who now holds the task, and refreshes the screens that show due dates.
export async function planTaskAction(move: PlanMove): Promise<PlanResult> {
  const user = await requirePermission("tasks.edit");
  if (!move || typeof move.taskId !== "string") return { ok: false, error: "Task not found." };
  let r;
  try {
    r = await planTask(db, { actor: user, move: { taskId: move.taskId, date: move.date ?? null, ...(move.assigneeId !== undefined ? { assigneeId: move.assigneeId } : {}) } });
  } catch (e) {
    if (e instanceof TaskError) return { ok: false, error: e.message };
    throw e;
  }
  if (!r.changed) return { ok: true };
  await audit(user, { action: "task.plan", entity: "Task", entityId: r.task.id, before: r.before, after: r.after });
  if (r.after.assigneeId !== r.before.assigneeId) {
    await taskAssigned(db, { organizationId: user.organizationId, taskId: r.task.id, toUserId: r.after.assigneeId, byUserId: user.id });
  } else if (r.after.assigneeId && r.after.assigneeId !== user.id && r.after.dueDate !== r.before.dueDate) {
    await notify(db, r.after.assigneeId, {
      kind: "task.rescheduled",
      title: r.after.dueDate ? `${user.name} moved a task to ${r.after.dueDate}` : `${user.name} took the due date off a task`,
      body: r.task.title,
      link: `/projects/${r.task.projectId}?task=${r.task.id}`,
    });
  }
  revalidatePath("/projects");
  revalidatePath(`/projects/${r.task.projectId}`);
  revalidatePath("/me/tasks");
  return { ok: true };
}

// ---------- Plan the week ----------

export type PlanSheetResult = { ok: true; lines: PlanLine[]; skipped: Skipped[] } | { ok: false; error: string };
export type PlanSaveResult = { ok: true; created: number; people: number } | { ok: false; error?: string; errors?: LineError[] };

const MAX_UPLOAD = 4 * 1024 * 1024;

// Reads the uploaded template (or any sheet with the same headings) into lines for the screen. Nothing is saved here.
export async function readPlanSheetAction(formData: FormData): Promise<PlanSheetResult> {
  const user = await requirePermission("tasks.edit");
  const { ctx } = await loadPlanContext(db, user, String(formData.get("week") ?? ""));
  if (ctx.projects.length === 0) return { ok: false, error: "You do not manage any open project, so there is nothing to plan." };
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Choose the Excel (.xlsx) or CSV file first." };
  if (file.size > MAX_UPLOAD) return { ok: false, error: "That file is over 4 MB. A week's plan is much smaller; check you picked the right file." };
  if (!/\.(xlsx|xlsm|csv)$/i.test(file.name)) return { ok: false, error: /\.xls$/i.test(file.name) ? "Old .xls files are not supported. Open it in Excel and save as .xlsx." : "Use the Excel (.xlsx) template or a CSV file." };
  let sheets;
  try {
    sheets = await readWorkbook(Buffer.from(await file.arrayBuffer()), file.name);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not read that file." };
  }
  const sheet = sheets.find((s) => s.rows.slice(0, 10).some((r) => r.some((c) => /^(task|title)/i.test(c.trim())))) ?? sheets[0];
  if (!sheet) return { ok: false, error: "That file has no rows." };
  const r = linesFromSheet(sheet.rows, ctx);
  if (r.lines.length > PLAN_MAX_LINES) return { ok: false, error: `That file has ${r.lines.length} tasks. Up to ${PLAN_MAX_LINES} at a time; split it into two files.` };
  return { ok: true, ...r };
}

// Last week's tasks one week later, for the manager to edit before saving.
export async function copyLastWeekAction(week: string): Promise<PlanSheetResult> {
  const user = await requirePermission("tasks.edit");
  const { ctx } = await loadPlanContext(db, user, String(week ?? ""));
  if (ctx.projects.length === 0) return { ok: false, error: "You do not manage any open project, so there is nothing to plan." };
  const lines = await linesFromLastWeek(db, ctx);
  return { ok: true, lines, skipped: [] };
}

// Saves the week: every line becomes a task, all at once or none. Each person hears once, with how many tasks they have.
export async function saveWeekPlanAction(week: string, lines: PlanLine[]): Promise<PlanSaveResult> {
  const user = await requirePermission("tasks.edit");
  if (!Array.isArray(lines)) return { ok: false, error: "Nothing to save." };
  const { ctx } = await loadPlanContext(db, user, String(week ?? ""));
  if (ctx.projects.length === 0) return { ok: false, error: "You do not manage any open project, so there is nothing to plan." };
  const clean: PlanLine[] = lines.slice(0, PLAN_MAX_LINES + 1).map((l) => ({
    personId: String(l?.personId ?? ""), projectId: String(l?.projectId ?? ""), date: String(l?.date ?? ""), title: String(l?.title ?? "").slice(0, 400),
    priority: String(l?.priority ?? "MEDIUM"), dueTime: String(l?.dueTime ?? "").trim(), hours: String(l?.hours ?? "").trim(),
  }));
  const r = await saveWeekPlan(db, { actor: user, ctx, lines: clean });
  if (!r.ok) return { ok: false, errors: r.errors };
  for (const t of r.saved.tasks) {
    await audit(user, { action: "task.create", entity: "Task", entityId: t.id, after: { title: t.title, projectId: t.projectId, assigneeId: t.assigneeId, dueDate: t.date, dueTime: t.dueTime, priority: t.priority, source: "week_plan" } });
  }
  const byPerson = new Map<string, typeof r.saved.tasks>();
  for (const t of r.saved.tasks) byPerson.set(t.assigneeId, [...(byPerson.get(t.assigneeId) ?? []), t]);
  const stamp = Date.now();
  const weekText = new Date(`${ctx.week}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  for (const [personId, list] of byPerson) {
    if (personId === user.id) continue;
    const names = list.slice(0, 3).map((t) => t.title).join(", ");
    await notify(db, personId, {
      kind: "task.week_planned", title: `${user.name} planned ${list.length} task${list.length === 1 ? "" : "s"} for your week`,
      body: `Week of ${weekText}: ${names}${list.length > 3 ? ` and ${list.length - 3} more` : ""}`, link: "/me/tasks?range=week", dedupeKey: `week-plan:${ctx.week}:${personId}:${stamp}`,
    });
  }
  revalidatePath("/projects");
  for (const id of new Set(r.saved.tasks.map((t) => t.projectId))) revalidatePath(`/projects/${id}`);
  revalidatePath("/me/tasks");
  return { ok: true, created: r.saved.tasks.length, people: byPerson.size };
}
