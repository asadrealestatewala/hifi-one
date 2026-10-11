"use server";

import { revalidatePath } from "next/cache";
import { audit, requirePermission, toActor } from "@/lib/auth";
import { AccountError, createRole, deleteRole, setRolePermissions } from "@/lib/accounts";
import { db } from "@/lib/db";

export type RoleState = { error?: string; done?: string };

export async function saveRole(_prev: RoleState, formData: FormData): Promise<RoleState> {
  const user = await requirePermission("roles.manage");
  const roleId = String(formData.get("roleId"));
  try {
    const keys = formData.getAll("permissionKeys").map(String);
    const r = await setRolePermissions(db, { organizationId: user.organizationId, roleId, permissionKeys: keys, actor: toActor(user) });
    await audit(user, { action: "role.permissions_changed", entity: "Role", entityId: roleId, before: { permissions: r.before }, after: { permissions: r.after } });
    await db.settingChange.create({ data: { organizationId: user.organizationId, section: `role:${r.roleName}`, actorId: user.id, before: { permissions: r.before }, after: { permissions: r.after } } });
    revalidatePath("/roles");
    return { done: r.affectedUsers > 0 ? `Saved. ${r.affectedUsers} user(s) with this role were signed out and pick up the change at next sign-in.` : "Saved." };
  } catch (e) {
    if (e instanceof AccountError) return { error: e.message };
    throw e;
  }
}

export async function addRole(_prev: RoleState, formData: FormData): Promise<RoleState> {
  const user = await requirePermission("roles.manage");
  try {
    const keys = formData.getAll("permissionKeys").map(String);
    const r = await createRole(db, { organizationId: user.organizationId, name: String(formData.get("name") ?? ""), permissionKeys: keys, actor: toActor(user) });
    await audit(user, { action: "role.create", entity: "Role", entityId: r.id, after: { name: r.name, permissions: keys } });
    revalidatePath("/roles");
    return { done: `Role "${r.name}" created.` };
  } catch (e) {
    if (e instanceof AccountError) return { error: e.message };
    throw e;
  }
}

export async function removeRole(_prev: RoleState, formData: FormData): Promise<RoleState> {
  const user = await requirePermission("roles.manage");
  const roleId = String(formData.get("roleId"));
  try {
    await deleteRole(db, { organizationId: user.organizationId, roleId });
    await audit(user, { action: "role.delete", entity: "Role", entityId: roleId });
    revalidatePath("/roles");
    return { done: "Role deleted." };
  } catch (e) {
    if (e instanceof AccountError) return { error: e.message };
    throw e;
  }
}
