// Task checklists: short steps inside one task ("Spelling checked", "Pixel firing"), and saved checklists the organization
// reuses on many tasks. A task can't be marked Done while an item is unticked (enforced in tasks.ts changeTaskStatus), and
// a Done task's checklist is locked until the task is reopened. Callers have already checked that the person may work on
// the task. Free of Next.js imports so it can be tested against the database.
import type { PrismaClient } from "@prisma/client";

type Db = PrismaClient;
export const MAX_CHECKLIST_ITEMS = 50;
export const MAX_SAVED_CHECKLISTS = 50;
export type ChecklistItem = { id: string; text: string; done: boolean; doneById: string | null; doneAt: Date | null };
export type ChecklistResult<T = null> = { ok: true; value: T } | { ok: false; error: string };

const clean = (raw: string) => raw.trim().replace(/\s+/g, " ").slice(0, 200);
// Several items can be pasted at once, one per line
export const splitItems = (raw: string) => raw.split(/\r?\n/).map(clean).filter((t) => t.length > 0);

export function listChecklist(db: Db, taskId: string): Promise<ChecklistItem[]> {
  return db.taskChecklistItem.findMany({ where: { taskId }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], select: { id: true, text: true, done: true, doneById: true, doneAt: true } });
}

async function openTask(db: Db, taskId: string): Promise<ChecklistResult<{ id: string }>> {
  const t = await db.task.findUnique({ where: { id: taskId }, select: { id: true, status: true } });
  if (!t) return { ok: false, error: "Task not found." };
  if (t.status === "DONE") return { ok: false, error: "This task is done. Move it back to In progress to change its checklist." };
  return { ok: true, value: { id: t.id } };
}

// Adds items at the end. Text already on the list (ignoring case) is skipped, so applying a saved checklist twice adds nothing.
export async function addChecklistItems(db: Db, p: { taskId: string; texts: string[] }): Promise<ChecklistResult<{ added: number }>> {
  const t = await openTask(db, p.taskId);
  if (!t.ok) return t;
  const existing = await db.taskChecklistItem.findMany({ where: { taskId: p.taskId }, select: { text: true, sortOrder: true } });
  const seen = new Set(existing.map((e) => e.text.toLowerCase()));
  const fresh: string[] = [];
  for (const raw of p.texts) { const x = clean(raw); if (x && !seen.has(x.toLowerCase())) { seen.add(x.toLowerCase()); fresh.push(x); } }
  if (!fresh.length) return p.texts.some((x) => clean(x)) ? { ok: true, value: { added: 0 } } : { ok: false, error: "Write the checklist item first." };
  if (existing.length + fresh.length > MAX_CHECKLIST_ITEMS) return { ok: false, error: `A task can have at most ${MAX_CHECKLIST_ITEMS} checklist items.` };
  let order = existing.reduce((m, e) => Math.max(m, e.sortOrder), -1);
  await db.taskChecklistItem.createMany({ data: fresh.map((text) => ({ taskId: p.taskId, text, sortOrder: ++order })) });
  return { ok: true, value: { added: fresh.length } };
}

export async function tickChecklistItem(db: Db, p: { taskId: string; itemId: string; done: boolean; userId: string; now?: Date }): Promise<ChecklistResult<{ text: string }>> {
  const t = await openTask(db, p.taskId);
  if (!t.ok) return t;
  const item = await db.taskChecklistItem.findFirst({ where: { id: p.itemId, taskId: p.taskId } });
  if (!item) return { ok: false, error: "Checklist item not found." };
  if (item.done !== p.done) await db.taskChecklistItem.update({ where: { id: item.id }, data: p.done ? { done: true, doneById: p.userId, doneAt: p.now ?? new Date() } : { done: false, doneById: null, doneAt: null } });
  return { ok: true, value: { text: item.text } };
}

export async function removeChecklistItem(db: Db, p: { taskId: string; itemId: string }): Promise<ChecklistResult<{ text: string }>> {
  const t = await openTask(db, p.taskId);
  if (!t.ok) return t;
  const item = await db.taskChecklistItem.findFirst({ where: { id: p.itemId, taskId: p.taskId } });
  if (!item) return { ok: false, error: "Checklist item not found." };
  await db.taskChecklistItem.delete({ where: { id: item.id } });
  return { ok: true, value: { text: item.text } };
}

// ---------- saved checklists (one list per organization) ----------
export function listSavedChecklists(db: Db, organizationId: string) {
  return db.checklistTemplate.findMany({ where: { organizationId }, orderBy: { name: "asc" }, select: { id: true, name: true, items: true } });
}

export async function saveChecklist(db: Db, p: { organizationId: string; name: string; items: string[]; byUserId: string }): Promise<ChecklistResult<{ id: string; name: string }>> {
  const name = p.name.trim().replace(/\s+/g, " ").slice(0, 60);
  if (name.length < 2) return { ok: false, error: "Give the saved checklist a name." };
  const items = p.items.map(clean).filter((i, n, all) => i && all.findIndex((x) => x.toLowerCase() === i.toLowerCase()) === n); // first spelling wins
  if (!items.length) return { ok: false, error: "Add checklist items to the task before saving them." };
  if (items.length > MAX_CHECKLIST_ITEMS) return { ok: false, error: `A checklist can have at most ${MAX_CHECKLIST_ITEMS} items.` };
  if (await db.checklistTemplate.findFirst({ where: { organizationId: p.organizationId, name: { equals: name, mode: "insensitive" } } })) return { ok: false, error: `There is already a saved checklist called ${name}.` };
  if ((await db.checklistTemplate.count({ where: { organizationId: p.organizationId } })) >= MAX_SAVED_CHECKLISTS) return { ok: false, error: `There are already ${MAX_SAVED_CHECKLISTS} saved checklists. Delete one you no longer use first.` };
  const c = await db.checklistTemplate.create({ data: { organizationId: p.organizationId, name, items, createdById: p.byUserId }, select: { id: true, name: true } });
  return { ok: true, value: c };
}

export async function applySavedChecklist(db: Db, p: { organizationId: string; templateId: string; taskId: string }): Promise<ChecklistResult<{ name: string; added: number }>> {
  const c = await db.checklistTemplate.findFirst({ where: { id: p.templateId, organizationId: p.organizationId } });
  if (!c) return { ok: false, error: "Saved checklist not found." };
  const r = await addChecklistItems(db, { taskId: p.taskId, texts: c.items });
  return r.ok ? { ok: true, value: { name: c.name, added: r.value.added } } : r;
}

export async function deleteSavedChecklist(db: Db, p: { organizationId: string; id: string }): Promise<ChecklistResult<{ name: string }>> {
  const c = await db.checklistTemplate.findFirst({ where: { id: p.id, organizationId: p.organizationId } });
  if (!c) return { ok: false, error: "Saved checklist not found." };
  await db.checklistTemplate.delete({ where: { id: c.id } });
  return { ok: true, value: { name: c.name } };
}
