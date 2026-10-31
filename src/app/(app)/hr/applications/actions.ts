"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { audit, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { ApplicationError, updateApplication } from "@/lib/job-applications";

const back = (id: string, extra: string) => `/hr/applications?open=${encodeURIComponent(id)}&${extra}`;

export async function updateApplicationAction(formData: FormData): Promise<void> {
  const user = await requirePermission("hr.manage");
  const id = String(formData.get("id") ?? "");
  try {
    const { before, after } = await updateApplication(db, user, { id, status: String(formData.get("status") ?? ""), notes: String(formData.get("notes") ?? "") });
    await audit(user, { action: "application.update", entity: "JobApplication", entityId: id, before: { status: before.status }, after: { status: after.status, notesChanged: before.notes !== after.notes } });
  } catch (e) {
    if (e instanceof ApplicationError) redirect(back(id, `error=${encodeURIComponent(e.message)}`));
    throw e;
  }
  revalidatePath("/hr/applications");
  redirect(back(id, "saved=1"));
}
