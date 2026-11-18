"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { audit, requireUser, viewAsToken, viewAsUserToken } from "@/lib/auth";
import { notify } from "@/lib/notifications";
import { db } from "@/lib/db";
import { VIEW_AS_COOKIE, VIEW_AS_USER_COOKIE, VIEW_AS_USER_HOURS, canPreviewRole, canViewAsUser, homePathForView } from "@/lib/view-as";

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

// Super Admin only: look at one person's own view (read-only). Works for staff, clients, vendors, partners and every other sign-in.
// The view lasts two hours, is written to the audit log, and the person can be told with an in-app notice.
export async function startViewAsPerson(userId: string, tellThem: boolean): Promise<ViewAsResult> {
  const user = await requireUser({ allowMustChange: true, allowMfaSetup: true });
  if (!user.realSuperAdmin || user.viewAsPerson) redirect("/forbidden");
  const target = await db.user.findFirst({ where: { id: userId, organizationId: user.organizationId }, include: { roles: { include: { role: true } } } });
  if (!target) return { error: "That person does not exist." };
  const isSuperAdmin = target.roles.some((r) => r.role.key === "SUPER_ADMIN");
  if (!canViewAsUser(user.id, { id: target.id, active: target.active, isSuperAdmin })) return { error: "That account cannot be viewed (inactive, a Super Admin, or yourself)." };
  const jar = await cookies();
  const expiresAt = new Date(Date.now() + VIEW_AS_USER_HOURS * 3600_000);
  jar.delete(VIEW_AS_COOKIE);
  jar.set(VIEW_AS_USER_COOKIE, await viewAsUserToken(user.id, target.id, expiresAt), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", expires: expiresAt });
  await audit(user, { action: "auth.view_as_person_start", entity: "User", entityId: target.id, after: { userType: target.userType, notified: tellThem } });
  if (tellThem) await notify(db, target.id, { kind: "view_as", title: "A Super Admin viewed your portal", body: "To help with an issue you reported, a Super Admin looked at your screens in read-only mode. Nothing was changed." });
  revalidatePath("/", "layout");
  redirect(homePathForView(target.userType));
}
