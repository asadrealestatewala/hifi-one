"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { audit, requirePermission, toActor } from "@/lib/auth";
import { AccountError, createResetLink } from "@/lib/accounts";
import { db } from "@/lib/db";
import { StaffError, createStaff, ensureStaffProfile, markVerified, setStaffArchived, setStaffStatus, updateStaff, type StaffInput, type StaffStatus } from "@/lib/staff";

export type StaffFormState = { error?: string; sameName?: boolean; values?: Record<string, string>; roleKeys?: string[]; n?: number; created?: { id: string; name: string; employeeNo: string; link?: string }; saved?: boolean };
export type LinkState = { link?: string; error?: string };

async function origin() {
  const h = await headers();
  return `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
}

const str = (f: FormData, k: string) => String(f.get(k) ?? "");
// What was typed, returned with an error so the form shows it again (never the CNIC, which stays server-side)
const kept = (f: FormData, n?: number) => ({ values: Object.fromEntries([...f.entries()].filter(([k, x]) => typeof x === "string" && k !== "identityNumber" && !k.startsWith("$")).map(([k, x]) => [k, String(x)])), roleKeys: f.getAll("roleKeys").map(String), n: (n ?? 0) + 1 });

function readInput(f: FormData): StaffInput {
  const join = str(f, "joinDate");
  if (join && !/^\d{4}-\d{2}-\d{2}$/.test(join)) throw new StaffError("Enter a valid joining date.");
  return {
    name: str(f, "name"), email: str(f, "email"), phone: str(f, "phone"), alternatePhone: str(f, "alternatePhone"), designation: str(f, "designation"),
    departmentId: str(f, "departmentId") || null, employmentType: str(f, "employmentType") || "FULL_TIME", joinDate: join ? new Date(`${join}T00:00:00Z`) : null,
    managerId: str(f, "managerId") || null, notes: str(f, "notes"), identityNumber: str(f, "identityNumber"),
  };
}

export async function createStaffAction(prev: StaffFormState, formData: FormData): Promise<StaffFormState> {
  const user = await requirePermission("hr.manage");
  try {
    const { user: created, profile } = await createStaff(db, {
      organizationId: user.organizationId, actor: toActor(user), roleKeys: formData.getAll("roleKeys").map(String), input: readInput(formData),
      canWriteSensitive: user.permissions.has("hr.view_sensitive"), allowSameName: formData.get("allowSameName") === "on",
    });
    await audit(user, { action: "staff.create", entity: "EmployeeProfile", entityId: profile.id, after: { employeeNo: profile.employeeNo, name: created.name, roles: formData.getAll("roleKeys").map(String), hasEmail: Boolean(created.email), hasPhone: Boolean(created.phone) } });
    let link: string | undefined;
    // Only people who manage sign-in access can hand out a setup link
    if (user.permissions.has("users.manage")) {
      const token = await createResetLink(db, { organizationId: user.organizationId, userId: created.id, createdById: user.id, hours: 72, actor: toActor(user) });
      await audit(user, { action: "user.setup_link", entity: "User", entityId: created.id });
      link = `${await origin()}/reset/${token}`;
    }
    revalidatePath("/hr/employees");
    return { created: { id: profile.id, name: created.name, employeeNo: profile.employeeNo, link } };
  } catch (e) {
    if (e instanceof StaffError) return { error: e.message, sameName: e.message.includes("same name"), ...kept(formData, prev.n) };
    throw e;
  }
}

export async function updateStaffAction(prev: StaffFormState, formData: FormData): Promise<StaffFormState> {
  const user = await requirePermission("hr.manage");
  const id = str(formData, "id");
  try {
    const r = await updateStaff(db, { organizationId: user.organizationId, profileId: id, input: readInput(formData), canWriteSensitive: user.permissions.has("hr.view_sensitive"), allowSameName: formData.get("allowSameName") === "on" });
    await audit(user, { action: "staff.update", entity: "EmployeeProfile", entityId: id, after: { changed: r.changed, identityChanged: r.identityChanged } });
    revalidatePath(`/hr/employees/${id}`);
    return { saved: true, n: (prev.n ?? 0) + 1 };
  } catch (e) {
    if (e instanceof StaffError) return { error: e.message, sameName: e.message.includes("same name"), ...kept(formData, prev.n) };
    throw e;
  }
}

const back = (id: string, k: "error" | "msg", m: string) => redirect(`/hr/employees/${id}?${k}=${encodeURIComponent(m)}`);

export async function staffStatusAction(formData: FormData): Promise<void> {
  const user = await requirePermission("hr.manage");
  const id = str(formData, "id");
  const op = str(formData, "op");
  try {
    if (op === "archive" || op === "restore") {
      await setStaffArchived(db, { organizationId: user.organizationId, profileId: id, archived: op === "archive", actor: toActor(user) });
      await audit(user, { action: `staff.${op}`, entity: "EmployeeProfile", entityId: id });
    } else if (op === "verify_email" || op === "verify_phone") {
      await markVerified(db, { organizationId: user.organizationId, profileId: id, what: op === "verify_email" ? "email" : "phone" });
      await audit(user, { action: `staff.${op}`, entity: "EmployeeProfile", entityId: id });
    } else {
      const status = op as StaffStatus;
      await setStaffStatus(db, { organizationId: user.organizationId, profileId: id, status, actor: toActor(user) });
      await audit(user, { action: "staff.status", entity: "EmployeeProfile", entityId: id, after: { status } });
    }
  } catch (e) {
    if (e instanceof StaffError) back(id, "error", e.message);
    throw e;
  }
  revalidatePath("/hr/employees");
  back(id, "msg", "Saved.");
}

export async function setupLinkAction(_prev: LinkState, formData: FormData): Promise<LinkState> {
  const user = await requirePermission("users.manage");
  const userId = str(formData, "userId");
  try {
    const token = await createResetLink(db, { organizationId: user.organizationId, userId, createdById: user.id, hours: 72, actor: toActor(user) });
    await audit(user, { action: "user.setup_link", entity: "User", entityId: userId });
    return { link: `${await origin()}/reset/${token}` };
  } catch (e) {
    if (e instanceof AccountError) return { error: e.message };
    throw e;
  }
}

export async function createProfileAction(formData: FormData): Promise<void> {
  const user = await requirePermission("hr.manage");
  let id: string;
  try {
    const prof = await ensureStaffProfile(db, { organizationId: user.organizationId, userId: str(formData, "userId") });
    await audit(user, { action: "staff.create_record", entity: "EmployeeProfile", entityId: prof.id, after: { employeeNo: prof.employeeNo } });
    id = prof.id;
  } catch (e) {
    if (e instanceof StaffError) redirect(`/hr/employees?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  redirect(`/hr/employees/${id}`);
}
