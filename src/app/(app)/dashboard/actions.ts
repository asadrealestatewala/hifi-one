"use server";

import { revalidatePath } from "next/cache";
import { audit, requirePermission } from "@/lib/auth";
import { resetLayout, saveLayout } from "@/lib/dashboard-layout";
import { availableWidgets } from "@/lib/dashboard-widgets";
import { db } from "@/lib/db";

type Saved = { ok: boolean };

export async function saveDashboardLayoutAction(order: string[], hidden: string[]): Promise<Saved> {
  const user = await requirePermission("dashboard.view");
  const ids = availableWidgets(user.permissions).map((w) => w.id);
  await saveLayout(db, user.id, { order: Array.isArray(order) ? order : [], hidden: Array.isArray(hidden) ? hidden : [] }, ids);
  await audit(user, { action: "dashboard.layout", entity: "UserPreference", entityId: user.id });
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function resetDashboardLayoutAction(): Promise<Saved> {
  const user = await requirePermission("dashboard.view");
  await resetLayout(db, user.id);
  revalidatePath("/dashboard");
  return { ok: true };
}
