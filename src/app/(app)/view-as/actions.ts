"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { audit, requireUser, viewAsToken } from "@/lib/auth";
import { db } from "@/lib/db";
import { VIEW_AS_COOKIE, canPreviewRole } from "@/lib/view-as";

export type ViewAsResult = { error?: string };

// Only a person who really holds Super Admin may preview a role (also while already previewing). Nobody else can set the cookie to any effect:
// it is signed, tied to that person, and ignored for anyone who is not a real Super Admin.
export async function startViewAs(roleKey: string): Promise<ViewAsResult> {
  const user = await requireUser({ allowMustChange: true, allowMfaSetup: true });
  if (!user.realSuperAdmin) redirect("/forbidden");
  if (!canPreviewRole(roleKey)) return { error: "That role cannot be previewed." };
  const role = await db.role.findUnique({ where: { organizationId_key: { organizationId: user.organizationId, key: roleKey } } });
  if (!role) return { error: "That role does not exist." };
  const expiresAt = new Date(Date.now() + 12 * 3600_000);
  (await cookies()).set(VIEW_AS_COOKIE, await viewAsToken(user.id, role.key, expiresAt), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", expires: expiresAt });
  await audit(user, { action: "auth.view_as_start", entity: "Role", entityId: role.id, after: { role: role.key } });
  revalidatePath("/", "layout");
  redirect("/dashboard");
}

export async function stopViewAs(): Promise<ViewAsResult> {
  const user = await requireUser({ allowMustChange: true, allowMfaSetup: true });
  if (!user.realSuperAdmin) redirect("/forbidden");
  (await cookies()).delete(VIEW_AS_COOKIE);
  if (user.viewAs) await audit(user, { action: "auth.view_as_stop", entity: "Role", after: { role: user.viewAs.roleKey } });
  revalidatePath("/", "layout");
  redirect("/dashboard");
}
