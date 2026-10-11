"use server";

import crypto from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { HrError, createEmployee } from "@/lib/hr";

export type CreateState = { error?: string; created?: { name: string; email: string; password: string; employeeNo: string } };

const schema = z.object({
  name: z.string().trim().min(2, "Name is required").max(200),
  email: z.string().trim().email("Enter a valid email"),
  roleKey: z.string().min(1),
  designation: z.string().trim().max(120).optional(),
  employmentType: z.enum(["FULL_TIME", "PART_TIME", "CONTRACT", "INTERN"]),
  workLocation: z.enum(["OFFICE", "REMOTE", "HYBRID", "FIELD"]),
  joinDate: z.string().optional(),
  managerId: z.string().optional(),
});

export async function createEmployeeAction(_prev: CreateState, formData: FormData): Promise<CreateState> {
  const user = await requirePermission("hr.manage");
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;
  // Only a Super Admin may hand out the Super Admin role.
  if (d.roleKey === "SUPER_ADMIN" && !user.roles.includes("Super Admin")) return { error: "Only a Super Admin can create another Super Admin." };
  const password = crypto.randomBytes(12).toString("base64url"); // shown once, never stored in plain text
  try {
    const created = await createEmployee(db, {
      organizationId: user.organizationId, name: d.name, email: d.email, password, roleKey: d.roleKey, designation: d.designation,
      employmentType: d.employmentType, workLocation: d.workLocation, joinDate: d.joinDate ? new Date(d.joinDate) : null, managerId: d.managerId || null,
    });
    const profile = await db.employeeProfile.findUniqueOrThrow({ where: { userId: created.id } });
    await audit(user, { action: "employee.create", entity: "User", entityId: created.id, after: { name: d.name, role: d.roleKey, employeeNo: profile.employeeNo } });
    revalidatePath("/hr/employees");
    return { created: { name: d.name, email: created.email, password, employeeNo: profile.employeeNo } };
  } catch (e) {
    if (e instanceof HrError) return { error: e.message };
    throw e;
  }
}
