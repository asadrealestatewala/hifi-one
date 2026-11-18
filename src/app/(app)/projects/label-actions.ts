"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { audit, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { createLabel, deleteLabel, updateLabel } from "@/lib/task-labels";

// The organization's task labels, managed from Projects → Tasks → Labels by people with projects.manage.
const back = (q: string) => `/projects?view=tasks&labels=1&${q}`;

export async function createLabelAction(formData: FormData): Promise<void> {
  const user = await requirePermission("projects.manage");
  const r = await createLabel(db, { organizationId: user.organizationId, name: String(formData.get("name") ?? ""), color: String(formData.get("color") ?? "primary") });
  if (!r.ok) redirect(back(`labelError=${encodeURIComponent(r.error)}`));
  await audit(user, { action: "task_label.create", entity: "TaskLabel", entityId: r.value.id, after: { name: r.value.name, color: r.value.color } });
  revalidatePath("/projects");
  redirect(back(`labelOk=${encodeURIComponent(`Added ${r.value.name}.`)}`));
}

export async function updateLabelAction(formData: FormData): Promise<void> {
  const user = await requirePermission("projects.manage");
  const id = String(formData.get("id") ?? "");
  const before = await db.taskLabel.findFirst({ where: { id, organizationId: user.organizationId }, select: { name: true, color: true } });
  const r = await updateLabel(db, { organizationId: user.organizationId, id, name: String(formData.get("name") ?? ""), color: String(formData.get("color") ?? "") });
  if (!r.ok) redirect(back(`labelError=${encodeURIComponent(r.error)}`));
  await audit(user, { action: "task_label.update", entity: "TaskLabel", entityId: id, before, after: { name: r.value.name, color: r.value.color } });
  revalidatePath("/projects");
  redirect(back(`labelOk=${encodeURIComponent(`Saved ${r.value.name}.`)}`));
}

export async function deleteLabelAction(formData: FormData): Promise<void> {
  const user = await requirePermission("projects.manage");
  const id = String(formData.get("id") ?? "");
  const r = await deleteLabel(db, { organizationId: user.organizationId, id });
  if (!r.ok) redirect(back(`labelError=${encodeURIComponent(r.error)}`));
  await audit(user, { action: "task_label.delete", entity: "TaskLabel", entityId: id, before: { name: r.value.name }, after: { removedFromTasks: r.value.tasks } });
  revalidatePath("/projects");
  redirect(back(`labelOk=${encodeURIComponent(`Removed ${r.value.name} from the list and from ${r.value.tasks} task${r.value.tasks === 1 ? "" : "s"}.`)}`));
}
