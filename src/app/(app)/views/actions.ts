"use server";

import { redirect } from "next/navigation";
import { audit, requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { ViewError, VIEW_LISTS, deleteView, saveView } from "@/lib/saved-views";

const s = (f: FormData, k: string) => String(f.get(k) ?? "");

// Views are personal. The list's own permission is still required to save one, and opening a view always goes through the page's own checks.
export async function saveViewAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const list = s(formData, "list");
  const def = VIEW_LISTS[list];
  if (!def || !user.permissions.has(def.permission as never)) redirect("/forbidden");
  const to = def.path;
  try {
    await saveView(db, { userId: user.id, list, name: s(formData, "name"), query: s(formData, "query") });
    await audit(user, { action: "view.save", entity: "UserPreference", entityId: user.id, after: { list, name: s(formData, "name").slice(0, 40) } });
  } catch (e) {
    if (e instanceof ViewError) redirect(`${def.path}?${s(formData, "query")}${s(formData, "query") ? "&" : ""}viewError=${encodeURIComponent(e.message)}`);
    throw e;
  }
  const q = new URLSearchParams(s(formData, "query"));
  q.delete("page");
  redirect(`${to}${q.toString() ? `?${q}` : ""}`);
}

export async function deleteViewAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const list = s(formData, "list");
  const def = VIEW_LISTS[list];
  if (!def) redirect("/forbidden");
  await deleteView(db, { userId: user.id, list, name: s(formData, "name") });
  await audit(user, { action: "view.delete", entity: "UserPreference", entityId: user.id, after: { list } });
  redirect(def.path);
}
