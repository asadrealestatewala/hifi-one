// Staff records: the employee directory's rules. One person = one User (sign-in, roles, status) plus one
// EmployeeProfile (HR details). Free of Next.js imports so it can be tested against the database.
//
// Rules enforced here:
// - Missing details stay empty. Nothing is invented: no placeholder emails, CNICs or numbers.
// - Email and registered contact number are each unique across all users; phone numbers are stored in E.164.
// - A new staff member gets no usable password. They set one through a one-time setup link.
// - Deactivating, exiting or archiving never deletes anything; history stays attached to the person.
// - CNIC and other identity data are written only by callers allowed to see them.
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import type { Prisma, PrismaClient } from "@prisma/client";
import { setUserActive, type Actor } from "./accounts";

export class StaffError extends Error {}

type Db = PrismaClient;
const EXTERNAL = ["CLIENT", "VENDOR", "BUSINESS_PARTNER", "INVESTOR"];
export const STAFF_STATUSES = ["ACTIVE", "INACTIVE", "EXITED"] as const;
export type StaffStatus = (typeof STAFF_STATUSES)[number];
export const EMPLOYMENT_TYPES = ["FULL_TIME", "PART_TIME", "CONTRACT", "INTERN"] as const;

// ----- normalisers (pure) -----

// Phone numbers become E.164 (+ and 8 to 15 digits). A local number starting with 0 takes the default country
// code (Pakistan, 92). Anything else without a country code is refused rather than guessed.
export function normalizeStaffPhone(raw: string | null | undefined, defaultCountry = "92"): string | null {
  const v = (raw ?? "").trim();
  if (!v) return null;
  let d = v.replace(/[\s\-().]/g, "");
  if (d.startsWith("00")) d = "+" + d.slice(2);
  if (/^0\d{9,11}$/.test(d)) d = `+${defaultCountry}${d.slice(1)}`;
  if (!/^\+[1-9]\d{7,14}$/.test(d)) throw new StaffError("Enter the contact number with its country code, for example +923001234567.");
  return d;
}

export function normalizeStaffEmail(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim().toLowerCase();
  if (!v) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) throw new StaffError("Enter a valid email address.");
  return v;
}

// Pakistani CNIC: 13 digits, stored as 12345-1234567-1. Other identity documents are kept as typed.
export function normalizeCnic(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim();
  if (!v) return null;
  const digits = v.replace(/[\s-]/g, "");
  if (/^\d{13}$/.test(digits)) return `${digits.slice(0, 5)}-${digits.slice(5, 12)}-${digits.slice(12)}`;
  if (/^\d+$/.test(digits)) throw new StaffError("A CNIC has 13 digits.");
  if (v.length > 40) throw new StaffError("The identity number is too long.");
  return v;
}

// Shows only the last 4 digits, for anyone without the sensitive permission.
export const maskIdentity = (v: string | null) => (v ? `•••••-•••••${v.replace(/\D/g, "").slice(-4)}` : null);

// ----- records -----

export type StaffInput = {
  name: string;
  email?: string | null;
  phone?: string | null;
  alternatePhone?: string | null;
  designation?: string | null;
  departmentId?: string | null;
  employmentType?: string;
  joinDate?: Date | null;
  managerId?: string | null;
  notes?: string | null;
  identityNumber?: string | null; // only applied when canWriteSensitive
};

async function nextEmployeeNo(tx: Prisma.TransactionClient, organizationId: string) {
  const seq = await tx.numberSequence.upsert({
    where: { organizationId_key: { organizationId, key: "EMP" } },
    create: { organizationId, key: "EMP", next: 2 },
    update: { next: { increment: 1 } },
  });
  return `E-${String(seq.next - 1).padStart(4, "0")}`;
}

async function checkUnique(db: Db | Prisma.TransactionClient, p: { email: string | null; phone: string | null; exceptUserId?: string }) {
  if (p.email) {
    const u = await db.user.findUnique({ where: { email: p.email }, select: { id: true, name: true } });
    if (u && u.id !== p.exceptUserId) throw new StaffError(`This email already belongs to ${u.name}.`);
  }
  if (p.phone) {
    const u = await db.user.findUnique({ where: { phone: p.phone }, select: { id: true, name: true } });
    if (u && u.id !== p.exceptUserId) throw new StaffError(`This contact number already belongs to ${u.name}.`);
  }
}

async function checkRefs(db: Db | Prisma.TransactionClient, organizationId: string, i: StaffInput, selfId?: string) {
  if (i.departmentId && !(await db.department.findFirst({ where: { id: i.departmentId, organizationId } }))) throw new StaffError("Unknown department.");
  if (i.managerId) {
    if (i.managerId === selfId) throw new StaffError("A person cannot report to themselves.");
    if (!(await db.user.findFirst({ where: { id: i.managerId, organizationId, userType: "EMPLOYEE" } }))) throw new StaffError("Unknown reporting manager.");
  }
  if (i.employmentType && !(EMPLOYMENT_TYPES as readonly string[]).includes(i.employmentType)) throw new StaffError("Choose an employment type.");
}

const clean = (v: string | null | undefined, max = 300) => {
  const t = (v ?? "").trim();
  return t ? t.slice(0, max) : null;
};

// Possible duplicates by name among current staff (same name, case-insensitive). The screen asks for confirmation.
export async function sameNameStaff(db: Db, organizationId: string, name: string, exceptUserId?: string) {
  return db.user.findMany({ where: { organizationId, userType: "EMPLOYEE", name: { equals: name.trim(), mode: "insensitive" }, ...(exceptUserId ? { id: { not: exceptUserId } } : {}) }, select: { id: true, name: true } });
}

export async function createStaff(db: Db, p: { organizationId: string; actor: Actor; roleKeys: string[]; input: StaffInput; canWriteSensitive: boolean; allowSameName?: boolean }) {
  const i = p.input;
  const name = clean(i.name, 160);
  if (!name || name.length < 2) throw new StaffError("Enter the person's name.");
  const email = normalizeStaffEmail(i.email);
  const phone = normalizeStaffPhone(i.phone);
  const alt = i.alternatePhone ? normalizeStaffPhone(i.alternatePhone) : null;
  const identityNumber = p.canWriteSensitive ? normalizeCnic(i.identityNumber) : null;
  await checkUnique(db, { email, phone });
  await checkRefs(db, p.organizationId, i);
  if (!p.allowSameName && (await sameNameStaff(db, p.organizationId, name)).length > 0) throw new StaffError(`A staff member named ${name} already exists. Confirm to add another person with the same name.`);
  const roles = await db.role.findMany({ where: { organizationId: p.organizationId, key: { in: p.roleKeys } } });
  if (roles.length === 0 || roles.length !== new Set(p.roleKeys).size || roles.some((r) => EXTERNAL.includes(r.key))) throw new StaffError("Choose at least one staff role.");
  if (roles.some((r) => r.key === "SUPER_ADMIN") && !p.actor.isSuperAdmin) throw new StaffError("Only a Super Admin can give someone the Super Admin role.");
  // Nobody can create a person with access they do not hold themselves
  if (!p.actor.isSuperAdmin) {
    const held = await db.rolePermission.findMany({ where: { roleId: { in: roles.map((r) => r.id) } }, include: { permission: true } });
    if (held.some((h) => !p.actor.permissions.has(h.permission.key))) throw new StaffError("You cannot give a role with permissions you do not hold.");
  }
  // No usable password: a random secret nobody knows. The person sets their own through a setup link.
  const passwordHash = await bcrypt.hash(crypto.randomBytes(32).toString("base64url"), 12);
  try {
    return await db.$transaction(async (tx) => {
      const employeeNo = await nextEmployeeNo(tx, p.organizationId);
      const user = await tx.user.create({
        data: {
          organizationId: p.organizationId, name, email, phone, passwordHash, userType: "EMPLOYEE", mustChangePassword: true,
          departmentId: i.departmentId || null, managerId: i.managerId || null, roles: { create: roles.map((r) => ({ roleId: r.id })) },
        },
      });
      const profile = await tx.employeeProfile.create({
        data: {
          organizationId: p.organizationId, userId: user.id, employeeNo, designation: clean(i.designation, 120), departmentId: i.departmentId || null,
          employmentType: i.employmentType ?? "FULL_TIME", joinDate: i.joinDate ?? null, phone: alt, notes: clean(i.notes, 2000), identityNumber,
        },
      });
      return { user, profile };
    });
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") throw new StaffError("This email or contact number is already in use.");
    throw e;
  }
}

export async function updateStaff(db: Db, p: { organizationId: string; profileId: string; input: StaffInput; canWriteSensitive: boolean; allowSameName?: boolean }) {
  const prof = await db.employeeProfile.findFirst({ where: { id: p.profileId, organizationId: p.organizationId } });
  if (!prof) throw new StaffError("Staff record not found.");
  const user = await db.user.findUniqueOrThrow({ where: { id: prof.userId } });
  const i = p.input;
  const name = clean(i.name, 160);
  if (!name || name.length < 2) throw new StaffError("Enter the person's name.");
  const email = normalizeStaffEmail(i.email);
  const phone = normalizeStaffPhone(i.phone);
  const alt = i.alternatePhone ? normalizeStaffPhone(i.alternatePhone) : null;
  await checkUnique(db, { email, phone, exceptUserId: user.id });
  await checkRefs(db, p.organizationId, i, user.id);
  if (!p.allowSameName && name.toLowerCase() !== user.name.toLowerCase() && (await sameNameStaff(db, p.organizationId, name, user.id)).length > 0) throw new StaffError(`A staff member named ${name} already exists. Confirm to use the same name.`);
  const identityNumber = p.canWriteSensitive ? normalizeCnic(i.identityNumber) : prof.identityNumber;
  const changed: string[] = [];
  const before = { name: user.name, email: user.email, phone: user.phone, alternatePhone: prof.phone, designation: prof.designation, departmentId: user.departmentId, employmentType: prof.employmentType, joinDate: prof.joinDate?.toISOString().slice(0, 10) ?? null, managerId: user.managerId, notes: prof.notes };
  const after = { name, email, phone, alternatePhone: alt, designation: clean(i.designation, 120), departmentId: i.departmentId || null, employmentType: i.employmentType ?? prof.employmentType, joinDate: i.joinDate?.toISOString().slice(0, 10) ?? null, managerId: i.managerId || null, notes: clean(i.notes, 2000) };
  for (const k of Object.keys(after) as (keyof typeof after)[]) if (before[k] !== after[k]) changed.push(k);
  const identityChanged = p.canWriteSensitive && identityNumber !== prof.identityNumber;
  await db.$transaction([
    db.user.update({
      where: { id: user.id },
      data: {
        name, email, phone, departmentId: after.departmentId, managerId: after.managerId,
        // A changed address or number is no longer verified
        ...(email !== user.email ? { emailVerifiedAt: null } : {}), ...(phone !== user.phone ? { phoneVerifiedAt: null } : {}),
      },
    }),
    db.employeeProfile.update({
      where: { id: prof.id },
      data: { designation: after.designation, departmentId: after.departmentId, employmentType: after.employmentType, joinDate: i.joinDate ?? null, phone: alt, notes: after.notes, identityNumber },
    }),
  ]);
  // Audit lists which fields changed; it never stores the identity number itself
  return { changed, identityChanged };
}

// Gives an existing staff account (made on the Users screen) its employee ID and HR record. Safe to repeat.
export async function ensureStaffProfile(db: Db, p: { organizationId: string; userId: string }) {
  const user = await db.user.findFirst({ where: { id: p.userId, organizationId: p.organizationId, userType: "EMPLOYEE" } });
  if (!user) throw new StaffError("Staff account not found.");
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${user.id} FOR UPDATE`;
    const found = await tx.employeeProfile.findUnique({ where: { userId: user.id } });
    if (found) return found;
    return tx.employeeProfile.create({ data: { organizationId: p.organizationId, userId: user.id, employeeNo: await nextEmployeeNo(tx, p.organizationId), departmentId: user.departmentId, status: user.active ? "ACTIVE" : "INACTIVE" } });
  });
}

// ACTIVE, INACTIVE (temporarily off; cannot sign in) or EXITED (left the company). History is never removed.
export async function setStaffStatus(db: Db, p: { organizationId: string; profileId: string; status: StaffStatus; actor: Actor }) {
  if (!(STAFF_STATUSES as readonly string[]).includes(p.status)) throw new StaffError("Choose a status.");
  const prof = await db.employeeProfile.findFirst({ where: { id: p.profileId, organizationId: p.organizationId } });
  if (!prof) throw new StaffError("Staff record not found.");
  if (prof.archivedAt && p.status === "ACTIVE") throw new StaffError("Restore the record from the archive first.");
  try {
    await setUserActive(db, { organizationId: p.organizationId, userId: prof.userId, active: p.status === "ACTIVE", actor: p.actor });
  } catch (e) {
    throw new StaffError((e as Error).message);
  }
  return db.employeeProfile.update({ where: { id: prof.id }, data: { status: p.status, exitDate: p.status === "EXITED" ? prof.exitDate ?? new Date() : p.status === "ACTIVE" ? null : prof.exitDate } });
}

// Archive hides a record from the directory and blocks sign-in; restore brings it back as INACTIVE.
export async function setStaffArchived(db: Db, p: { organizationId: string; profileId: string; archived: boolean; actor: Actor }) {
  const prof = await db.employeeProfile.findFirst({ where: { id: p.profileId, organizationId: p.organizationId } });
  if (!prof) throw new StaffError("Staff record not found.");
  if (p.archived) {
    if (prof.status === "ACTIVE") await setStaffStatus(db, { organizationId: p.organizationId, profileId: prof.id, status: "INACTIVE", actor: p.actor });
    return db.employeeProfile.update({ where: { id: prof.id }, data: { archivedAt: new Date() } });
  }
  return db.employeeProfile.update({ where: { id: prof.id }, data: { archivedAt: null } });
}

export async function markVerified(db: Db, p: { organizationId: string; profileId: string; what: "email" | "phone" }) {
  const prof = await db.employeeProfile.findFirst({ where: { id: p.profileId, organizationId: p.organizationId } });
  if (!prof) throw new StaffError("Staff record not found.");
  const user = await db.user.findUniqueOrThrow({ where: { id: prof.userId } });
  if (p.what === "email" && !user.email) throw new StaffError("There is no email to verify.");
  if (p.what === "phone" && !user.phone) throw new StaffError("There is no contact number to verify.");
  return db.user.update({ where: { id: user.id }, data: p.what === "email" ? { emailVerifiedAt: new Date() } : { phoneVerifiedAt: new Date() } });
}

// ----- directory query -----

export type StaffFilters = { q?: string; status?: string; departmentId?: string; designation?: string; roleKey?: string; campaignId?: string; projectId?: string; archived?: boolean };

// Directory filter. A project filter matches its members (ProjectMember) and its manager.

export async function staffWhere(db: Db, organizationId: string, f: StaffFilters): Promise<Prisma.EmployeeProfileWhereInput> {
  const userWhere: Prisma.UserWhereInput = {
    ...(f.roleKey ? { roles: { some: { role: { key: f.roleKey } } } } : {}),
    ...(f.campaignId ? { campaigns: { some: { campaignId: f.campaignId } } } : {}),
  };
  let ids = {};
  if (f.projectId) {
    const pr = await db.project.findFirst({ where: { id: f.projectId, organizationId }, select: { managerId: true, members: { select: { userId: true } } } });
    ids = { userId: { in: pr ? [pr.managerId, ...pr.members.map((m) => m.userId)] : [] } };
  }
  return {
    organizationId,
    archivedAt: f.archived ? { not: null } : null,
    ...(f.status && (STAFF_STATUSES as readonly string[]).includes(f.status) ? { status: f.status } : {}),
    ...(f.departmentId ? { departmentId: f.departmentId } : {}),
    ...(f.designation ? { designation: { equals: f.designation, mode: "insensitive" } } : {}),
    ...(Object.keys(userWhere).length ? { user: userWhere } : {}),
    ...ids,
    ...(f.q ? { OR: [
      { employeeNo: { contains: f.q, mode: "insensitive" } }, { designation: { contains: f.q, mode: "insensitive" } },
      { user: { OR: [{ name: { contains: f.q, mode: "insensitive" } }, { email: { contains: f.q, mode: "insensitive" } }, { phone: { contains: f.q.replace(/[\s-]/g, "") } }] } },
    ] } : {}),
  };
}
