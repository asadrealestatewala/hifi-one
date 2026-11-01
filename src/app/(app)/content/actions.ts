"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { audit, requirePermission } from "@/lib/auth";
import { ContentError, createContent, reschedule } from "@/lib/content";
import { db } from "@/lib/db";

export type RescheduleResult = { ok: boolean; error?: string };

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

// "Plan a post": saved as a draft, then the creative files are attached on the post's own page.
export async function createPostAction(formData: FormData): Promise<void> {
  const user = await requirePermission("content.manage");
  let id: string;
  try {
    const item = await createContent(db, {
      organizationId: user.organizationId, createdById: user.id, title: s(formData, "title"), copy: String(formData.get("copy") ?? ""), hashtags: s(formData, "hashtags"),
      platforms: formData.getAll("platforms").map(String), postType: s(formData, "postType"), plannedDate: s(formData, "plannedDate") || undefined, plannedTime: s(formData, "plannedTime") || undefined,
      clientId: s(formData, "clientId") || null, assignedToId: s(formData, "assignedToId") || null, brief: String(formData.get("brief") ?? ""), sampleUrl: s(formData, "sampleUrl"),
    });
    id = item.id;
    await audit(user, { action: "content.create", entity: "ContentItem", entityId: id, after: { title: item.title, platforms: item.platforms, postType: item.postType } });
  } catch (e) {
    if (e instanceof ContentError) redirect(`/content?new=1&error=${encodeURIComponent(e.message)}${s(formData, "plannedDate") ? `&date=${encodeURIComponent(s(formData, "plannedDate"))}` : ""}`);
    throw e;
  }
  redirect(`/content/${id}?created=1`);
}

// Dragging a post to another day on the calendar.
export async function reschedulePostAction(id: string, plannedDate: string): Promise<RescheduleResult> {
  const user = await requirePermission("content.manage");
  try {
    await reschedule(db, { organizationId: user.organizationId, id, plannedDate });
    await audit(user, { action: "content.reschedule", entity: "ContentItem", entityId: id, after: { plannedDate } });
  } catch (e) {
    if (e instanceof ContentError) return { ok: false, error: e.message };
    throw e;
  }
  revalidatePath("/content");
  return { ok: true };
}
