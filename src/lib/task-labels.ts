// Task labels: one short list per organization (Copy, Design, Ads…) that every project's tasks can carry. A task keeps the
// label ids in Task.labelIds. Free of Next.js imports so it can be tested against the database.
import type { PrismaClient } from "@prisma/client";

type Db = PrismaClient;

export const LABEL_COLORS = ["primary", "success", "warning", "danger", "info", "discovery", "neutral"] as const;
export type LabelColor = (typeof LABEL_COLORS)[number];
export const LABEL_COLOR_NAME: Record<LabelColor, string> = { primary: "Violet", success: "Green", warning: "Amber", danger: "Red", info: "Blue", discovery: "Purple", neutral: "Grey" };
export const MAX_LABELS = 40;
export const MAX_LABELS_PER_TASK = 6;
export type Label = { id: string; name: string; color: string };
export type LabelResult<T = Label> = { ok: true; value: T } | { ok: false; error: string };

const cleanName = (raw: string) => raw.trim().replace(/\s+/g, " ").slice(0, 40);
const checkName = (name: string) => (name.length < 1 ? "Give the label a name." : name.length > 24 ? "Keep label names to 24 characters." : null);
const checkColor = (c: string): c is LabelColor => (LABEL_COLORS as readonly string[]).includes(c);

export function listLabels(db: Db, organizationId: string): Promise<Label[]> {
  return db.taskLabel.findMany({ where: { organizationId }, orderBy: { name: "asc" }, select: { id: true, name: true, color: true } });
}

export async function createLabel(db: Db, p: { organizationId: string; name: string; color?: string }): Promise<LabelResult> {
  const name = cleanName(p.name);
  const color = p.color ?? "primary";
  const bad = checkName(name) ?? (checkColor(color) ? null : "Choose one of the label colours.");
  if (bad) return { ok: false, error: bad };
  if ((await db.taskLabel.count({ where: { organizationId: p.organizationId } })) >= MAX_LABELS) return { ok: false, error: `There are already ${MAX_LABELS} labels. Remove one you no longer use first.` };
  if (await db.taskLabel.findFirst({ where: { organizationId: p.organizationId, name: { equals: name, mode: "insensitive" } } })) return { ok: false, error: `There is already a label called ${name}.` };
  const l = await db.taskLabel.create({ data: { organizationId: p.organizationId, name, color }, select: { id: true, name: true, color: true } });
  return { ok: true, value: l };
}

export async function updateLabel(db: Db, p: { organizationId: string; id: string; name: string; color: string }): Promise<LabelResult> {
  const label = await db.taskLabel.findFirst({ where: { id: p.id, organizationId: p.organizationId } });
  if (!label) return { ok: false, error: "Label not found." };
  const name = cleanName(p.name);
  const bad = checkName(name) ?? (checkColor(p.color) ? null : "Choose one of the label colours.");
  if (bad) return { ok: false, error: bad };
  if (await db.taskLabel.findFirst({ where: { organizationId: p.organizationId, id: { not: label.id }, name: { equals: name, mode: "insensitive" } } })) return { ok: false, error: `There is already a label called ${name}.` };
  const l = await db.taskLabel.update({ where: { id: label.id }, data: { name, color: p.color }, select: { id: true, name: true, color: true } });
  return { ok: true, value: l };
}

// Removes the label from the list and from every task of this organization that carries it.
export async function deleteLabel(db: Db, p: { organizationId: string; id: string }): Promise<LabelResult<{ name: string; tasks: number }>> {
  const label = await db.taskLabel.findFirst({ where: { id: p.id, organizationId: p.organizationId } });
  if (!label) return { ok: false, error: "Label not found." };
  const tasks = await db.$transaction(async (tx) => {
    const n = await tx.$executeRaw`UPDATE "Task" t SET "labelIds" = array_remove(t."labelIds", ${label.id}) FROM "Project" p WHERE p."id" = t."projectId" AND p."organizationId" = ${p.organizationId} AND ${label.id} = ANY(t."labelIds")`;
    await tx.taskLabel.delete({ where: { id: label.id } });
    return n;
  });
  return { ok: true, value: { name: label.name, tasks } };
}

// Keeps only ids of this organization's labels, without repeats, at most MAX_LABELS_PER_TASK. Anything else is dropped.
export async function validLabelIds(db: Db, organizationId: string, ids: string[]): Promise<string[]> {
  const unique = [...new Set(ids.map(String).filter(Boolean))];
  if (!unique.length) return [];
  const found = new Set((await db.taskLabel.findMany({ where: { organizationId, id: { in: unique } }, select: { id: true } })).map((l) => l.id));
  return unique.filter((id) => found.has(id)).slice(0, MAX_LABELS_PER_TASK);
}
