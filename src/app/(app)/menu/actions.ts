"use server";

import { revalidatePath } from "next/cache";
import { audit, requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { sanitizeMenu } from "@/lib/menu-layout";
import { visibleNav } from "@/components/shell/nav";

export type MenuSaved = { ok: boolean };
const KEY = "menu";

// Save this person's menu: group order (from dragging or the arrows), hidden groups and items, icon colours and sidebar colour.
// Only groups and items they are allowed to see can be stored; anything else is dropped by sanitizeMenu.
export async function saveMenuAction(prefs: { order: string[]; hidden: string[]; colors: Record<string, string>; theme: string }): Promise<MenuSaved> {
  const user = await requireUser({ allowMustChange: true, allowMfaSetup: true });
  const clean = sanitizeMenu(prefs, visibleNav(user.permissions));
  await db.userPreference.upsert({ where: { userId_key: { userId: user.id, key: KEY } }, create: { userId: user.id, key: KEY, value: clean }, update: { value: clean } });
  await audit(user, { action: "menu.arrange", entity: "UserPreference", entityId: user.id });
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function resetMenuAction(): Promise<MenuSaved> {
  const user = await requireUser({ allowMustChange: true, allowMfaSetup: true });
  await db.userPreference.deleteMany({ where: { userId: user.id, key: KEY } });
  await audit(user, { action: "menu.reset", entity: "UserPreference", entityId: user.id });
  revalidatePath("/", "layout");
  return { ok: true };
}
