// Branches and departments, and which people belong to them. Names are unique per organization, a department with people in it
// cannot be deleted (archive a branch instead), and every change is made inside the caller's organization only.
import type { PrismaClient } from "@prisma/client";

export class OrgError extends Error {}
type Db = PrismaClient;
export const BRANCH_KINDS = ["REGISTERED_OFFICE", "SALES_CENTRE", "OFFICE"] as const;

const clean = (s: string, max: number, what: string) => {
  const v = s.trim();
  if (!v) throw new OrgError(`Give the ${what} a name.`);
  if (v.length > max) throw new OrgError(`The ${what} name is limited to ${max} characters.`);
  return v;
};

async function validTimezone(tz?: string | null) {
  if (!tz?.trim()) return null;
  try { new Intl.DateTimeFormat("en", { timeZone: tz.trim() }); return tz.trim(); } catch { throw new OrgError("That time zone is not recognised (for example Asia/Karachi)."); }
}

export async function addBranch(db: Db, p: { organizationId: string; name: string; kind: string; country?: string; address?: string; timezone?: string }) {
  const name = clean(p.name, 100, "branch");
  if (!(BRANCH_KINDS as readonly string[]).includes(p.kind)) throw new OrgError("Choose a branch type.");
  if (await db.branch.findUnique({ where: { organizationId_name: { organizationId: p.organizationId, name } } })) throw new OrgError("A branch with that name already exists.");
  return db.branch.create({ data: { organizationId: p.organizationId, name, kind: p.kind, country: p.country?.trim() || null, address: p.address?.trim().slice(0, 300) || null, timezone: await validTimezone(p.timezone) } });
}

export async function updateBranch(db: Db, p: { organizationId: string; branchId: string; name: string; kind: string; country?: string; address?: string; timezone?: string; active: boolean }) {
  const name = clean(p.name, 100, "branch");
  if (!(BRANCH_KINDS as readonly string[]).includes(p.kind)) throw new OrgError("Choose a branch type.");
  const clash = await db.branch.findFirst({ where: { organizationId: p.organizationId, name, id: { not: p.branchId } } });
  if (clash) throw new OrgError("A branch with that name already exists.");
  const r = await db.branch.updateMany({ where: { id: p.branchId, organizationId: p.organizationId }, data: { name, kind: p.kind, country: p.country?.trim() || null, address: p.address?.trim().slice(0, 300) || null, timezone: await validTimezone(p.timezone), active: p.active } });
  if (r.count === 0) throw new OrgError("Branch not found.");
}

export async function addDepartment(db: Db, p: { organizationId: string; name: string }) {
  const name = clean(p.name, 100, "department");
  if (await db.department.findUnique({ where: { organizationId_name: { organizationId: p.organizationId, name } } })) throw new OrgError("A department with that name already exists.");
  return db.department.create({ data: { organizationId: p.organizationId, name } });
}

export async function renameDepartment(db: Db, p: { organizationId: string; departmentId: string; name: string }) {
  const name = clean(p.name, 100, "department");
  if (await db.department.findFirst({ where: { organizationId: p.organizationId, name, id: { not: p.departmentId } } })) throw new OrgError("A department with that name already exists.");
  const r = await db.department.updateMany({ where: { id: p.departmentId, organizationId: p.organizationId }, data: { name } });
  if (r.count === 0) throw new OrgError("Department not found.");
}

export async function deleteDepartment(db: Db, p: { organizationId: string; departmentId: string }) {
  const d = await db.department.findFirst({ where: { id: p.departmentId, organizationId: p.organizationId }, include: { _count: { select: { users: true } } } });
  if (!d) throw new OrgError("Department not found.");
  if (d._count.users > 0) throw new OrgError(`${d._count.users} ${d._count.users === 1 ? "person is" : "people are"} still in this department. Move them first.`);
  await db.department.delete({ where: { id: d.id } });
}

// Moves one person. Either side may be cleared. The HR profile (which records the department) is kept in step.
export async function assignPerson(db: Db, p: { organizationId: string; userId: string; branchId: string | null; departmentId: string | null }) {
  const user = await db.user.findFirst({ where: { id: p.userId, organizationId: p.organizationId, userType: "EMPLOYEE" } });
  if (!user) throw new OrgError("Choose a staff member.");
  if (p.branchId && !(await db.branch.findFirst({ where: { id: p.branchId, organizationId: p.organizationId, active: true } }))) throw new OrgError("Choose an active branch.");
  if (p.departmentId && !(await db.department.findFirst({ where: { id: p.departmentId, organizationId: p.organizationId } }))) throw new OrgError("Choose a department.");
  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { branchId: p.branchId, departmentId: p.departmentId } });
    await tx.employeeProfile.updateMany({ where: { userId: user.id }, data: { departmentId: p.departmentId } });
  });
}
