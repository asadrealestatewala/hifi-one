"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { audit, requirePermission, toActor } from "@/lib/auth";
import { AccountError, adminResetMfa, createResetLink, createUser, setUserActive, setUserRoles } from "@/lib/accounts";
import { db } from "@/lib/db";
import { onboardingNotice, startOnboarding } from "@/lib/onboarding";

export type LinkState = { link?: string; error?: string; done?: string };

async function origin() {
  const h = await headers();
  return `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
}

export async function createStaffUser(_prev: LinkState, formData: FormData): Promise<LinkState> {
  const user = await requirePermission("users.manage");
  try {
    const roleKeys = formData.getAll("roleKeys").map(String);
    const created = await createUser(db, { organizationId: user.organizationId, name: String(formData.get("name") ?? ""), email: String(formData.get("email") ?? ""), roleKeys, actor: toActor(user) });
    // The new person sets their own password through a 24-hour link; nobody ever types or sees a temporary password
    const token = await createResetLink(db, { organizationId: user.organizationId, userId: created.id, createdById: user.id, hours: 24, actor: toActor(user) });
    await audit(user, { action: "user.create", entity: "User", entityId: created.id, after: { email: created.email, roles: roleKeys } });
    // The account cannot sign in until the person verifies their email with the emailed code and an approver accepts it
    const ob = await startOnboarding(db, { organizationId: user.organizationId, userId: created.id, requestedById: user.id });
    await audit(user, { action: "onboarding.start", entity: "User", entityId: created.id, after: { status: ob.request.status, codeEmail: ob.codeEmail } });
    revalidatePath("/users");
    return { link: `${await origin()}/reset/${token}`, done: `${created.name} was created. ${onboardingNotice(ob)}` };
  } catch (e) {
    if (e instanceof AccountError) return { error: e.message };
    throw e;
  }
}

export async function makeResetLink(_prev: LinkState, formData: FormData): Promise<LinkState> {
  const user = await requirePermission("users.manage");
  const userId = String(formData.get("userId"));
  try {
    const token = await createResetLink(db, { organizationId: user.organizationId, userId, createdById: user.id, actor: toActor(user) });
    await audit(user, { action: "user.reset_link", entity: "User", entityId: userId });
    return { link: `${await origin()}/reset/${token}` };
  } catch (e) {
    if (e instanceof AccountError) return { error: e.message };
    throw e;
  }
}

export async function changeRoles(_prev: LinkState, formData: FormData): Promise<LinkState> {
  const user = await requirePermission("users.manage");
  const userId = String(formData.get("userId"));
  try {
    const roleKeys = formData.getAll("roleKeys").map(String);
    await setUserRoles(db, { organizationId: user.organizationId, userId, roleKeys, actor: toActor(user) });
    await audit(user, { action: "user.roles_changed", entity: "User", entityId: userId, after: { roles: roleKeys } });
    revalidatePath(`/users/${userId}`);
    return { done: "Roles saved. The person is signed out and gets the new access at their next sign-in." };
  } catch (e) {
    if (e instanceof AccountError) return { error: e.message };
    throw e;
  }
}

export async function toggleActive(_prev: LinkState, formData: FormData): Promise<LinkState> {
  const user = await requirePermission("users.manage");
  const userId = String(formData.get("userId"));
  const active = formData.get("active") === "1";
  try {
    await setUserActive(db, { organizationId: user.organizationId, userId, active, actor: toActor(user) });
    await audit(user, { action: active ? "user.activate" : "user.deactivate", entity: "User", entityId: userId });
    revalidatePath(`/users/${userId}`);
    return { done: active ? "Account reactivated." : "Account deactivated and signed out everywhere." };
  } catch (e) {
    if (e instanceof AccountError) return { error: e.message };
    throw e;
  }
}

export async function resetMfa(_prev: LinkState, formData: FormData): Promise<LinkState> {
  const user = await requirePermission("users.manage");
  const userId = String(formData.get("userId"));
  try {
    await adminResetMfa(db, { organizationId: user.organizationId, userId, actor: toActor(user) });
    await audit(user, { action: "user.mfa_reset", entity: "User", entityId: userId });
    revalidatePath(`/users/${userId}`);
    return { done: "Two-step verification was reset and the person was signed out." };
  } catch (e) {
    if (e instanceof AccountError) return { error: e.message };
    throw e;
  }
}
