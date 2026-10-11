// User administration, roles, and password reset links. Free of Next.js imports so it can be tested against the database.
// Invariants enforced here, not in the screens: the system always keeps an active Super Admin, only a Super Admin
// can grant or remove that role, nobody can hand out permissions they do not hold, and any change to a user's
// access signs them out.
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import type { PrismaClient } from "@prisma/client";
import { ALL_PERMISSIONS, type PermissionKey } from "./permissions";

export class AccountError extends Error {}

export type Actor = { id: string; isSuperAdmin: boolean; permissions: ReadonlySet<string> };

const hash = (t: string) => crypto.createHash("sha256").update(t).digest("hex");
const EXTERNAL_KEYS = ["CLIENT", "VENDOR", "BUSINESS_PARTNER", "INVESTOR"];

async function revokeSessions(db: PrismaClient, userId: string) {
  await db.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
}

type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

// Serialises changes that could remove the last Super Admin: two people demoting each other at once must not both succeed.
async function lockSuperAdmins(tx: Tx, organizationId: string) {
  await tx.$queryRaw`SELECT id FROM "User" WHERE "organizationId" = ${organizationId} AND id IN (SELECT ur."userId" FROM "UserRole" ur JOIN "Role" r ON r.id = ur."roleId" WHERE r.key = 'SUPER_ADMIN') ORDER BY id FOR UPDATE`;
}

async function activeSuperAdmins(db: PrismaClient | Tx, organizationId: string) {
  return db.user.findMany({
    where: { organizationId, active: true, roles: { some: { role: { key: "SUPER_ADMIN" }, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } } },
    select: { id: true },
  });
}

// ----- Password reset links (used instead of email until delivery is connected) -----

export async function createResetLink(db: PrismaClient, p: { organizationId: string; userId: string; createdById: string; hours?: number; actor?: Actor }) {
  const user = await db.user.findFirst({ where: { id: p.userId, organizationId: p.organizationId }, include: { roles: { include: { role: true } } } });
  if (!user) throw new AccountError("User not found.");
  if (p.actor && !p.actor.isSuperAdmin && user.roles.some((r) => r.role.key === "SUPER_ADMIN")) throw new AccountError("Only a Super Admin can reset a Super Admin's password.");
  const token = crypto.randomBytes(32).toString("base64url");
  await db.passwordResetToken.create({ data: { userId: user.id, tokenHash: hash(token), expiresAt: new Date(Date.now() + (p.hours ?? 1) * 3600_000), createdById: p.createdById } });
  return token; // shown once; only the hash is stored
}

export async function resetInfo(db: PrismaClient, token: string) {
  const t = await db.passwordResetToken.findUnique({ where: { tokenHash: hash(token) } });
  if (!t || t.usedAt || t.expiresAt < new Date()) return null;
  const u = await db.user.findUnique({ where: { id: t.userId }, select: { email: true, active: true } });
  return u?.active ? { email: u.email } : null;
}

export async function consumeReset(db: PrismaClient, p: { token: string; password: string }) {
  if (p.password.length < 10) throw new AccountError("Use a password of at least 10 characters.");
  const passwordHash = await bcrypt.hash(p.password, 12);
  return db.$transaction(async (tx) => {
    const found = await tx.passwordResetToken.findUnique({ where: { tokenHash: hash(p.token) } });
    if (!found) throw new AccountError("This reset link is not valid.");
    await tx.$queryRaw`SELECT id FROM "PasswordResetToken" WHERE id = ${found.id} FOR UPDATE`;
    const t = await tx.passwordResetToken.findUniqueOrThrow({ where: { id: found.id } });
    if (t.usedAt || t.expiresAt < new Date()) throw new AccountError("This reset link was already used or has expired.");
    const user = await tx.user.update({ where: { id: t.userId }, data: { passwordHash, mustChangePassword: false, failedLogins: 0, lockedUntil: null } });
    await tx.passwordResetToken.updateMany({ where: { userId: t.userId, usedAt: null }, data: { usedAt: new Date() } }); // every outstanding link dies with this one
    await tx.session.updateMany({ where: { userId: t.userId, revokedAt: null }, data: { revokedAt: new Date() } });
    return user;
  });
}

// ----- Users -----

export async function createUser(
  db: PrismaClient,
  p: { organizationId: string; name: string; email: string; roleKeys: string[]; actor: Actor },
) {
  const email = p.email.trim().toLowerCase();
  if (p.name.trim().length < 2) throw new AccountError("Enter a name.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AccountError("Enter a valid email address.");
  if (await db.user.findUnique({ where: { email } })) throw new AccountError("A user with this email already exists.");
  const roles = await db.role.findMany({ where: { organizationId: p.organizationId, key: { in: p.roleKeys } } });
  if (roles.length === 0 || roles.length !== new Set(p.roleKeys).size) throw new AccountError("Choose at least one valid role.");
  if (roles.some((r) => EXTERNAL_KEYS.includes(r.key))) throw new AccountError("Clients and vendors are invited from their own pages.");
  if (roles.some((r) => r.key === "SUPER_ADMIN") && !p.actor.isSuperAdmin) throw new AccountError("Only a Super Admin can create another Super Admin.");
  // A random password nobody knows; the person sets their own through the reset link
  const passwordHash = await bcrypt.hash(crypto.randomBytes(24).toString("base64url"), 12);
  return db.user.create({
    data: { organizationId: p.organizationId, email, name: p.name.trim(), passwordHash, mustChangePassword: true, roles: { create: roles.map((r) => ({ roleId: r.id })) } },
  });
}

export async function setUserRoles(db: PrismaClient, p: { organizationId: string; userId: string; roleKeys: string[]; actor: Actor }) {
  return db.$transaction(async (tx) => {
    await lockSuperAdmins(tx, p.organizationId);
    const user = await tx.user.findFirst({ where: { id: p.userId, organizationId: p.organizationId }, include: { roles: { include: { role: true } } } });
    if (!user) throw new AccountError("User not found.");
    if (user.userType !== "EMPLOYEE") throw new AccountError("Only staff roles are changed here.");
    const roles = await tx.role.findMany({ where: { organizationId: p.organizationId, key: { in: p.roleKeys } } });
    if (roles.length === 0 || roles.length !== new Set(p.roleKeys).size) throw new AccountError("Choose at least one valid role.");
    if (roles.some((r) => EXTERNAL_KEYS.includes(r.key))) throw new AccountError("Staff cannot hold a client or vendor role.");
    const hadSuper = user.roles.some((r) => r.role.key === "SUPER_ADMIN");
    const willSuper = roles.some((r) => r.key === "SUPER_ADMIN");
    if (hadSuper !== willSuper && !p.actor.isSuperAdmin) throw new AccountError("Only a Super Admin can grant or remove the Super Admin role.");
    if (hadSuper && !willSuper && user.active) {
      const others = (await activeSuperAdmins(tx, p.organizationId)).filter((u) => u.id !== user.id);
      if (others.length === 0) throw new AccountError("The system must keep at least one active Super Admin.");
    }
    await tx.userRole.deleteMany({ where: { userId: user.id } });
    await tx.userRole.createMany({ data: roles.map((r) => ({ userId: user.id, roleId: r.id })) });
    await tx.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } }); // new access applies at next sign-in
    return user;
  });
}

export async function setUserActive(db: PrismaClient, p: { organizationId: string; userId: string; active: boolean; actor: Actor }) {
  return db.$transaction(async (tx) => {
    await lockSuperAdmins(tx, p.organizationId);
    const user = await tx.user.findFirst({ where: { id: p.userId, organizationId: p.organizationId }, include: { roles: { include: { role: true } } } });
    if (!user) throw new AccountError("User not found.");
    if (!p.active) {
      if (user.id === p.actor.id) throw new AccountError("You cannot deactivate your own account.");
      const isSuper = user.roles.some((r) => r.role.key === "SUPER_ADMIN");
      if (isSuper && !p.actor.isSuperAdmin) throw new AccountError("Only a Super Admin can deactivate a Super Admin.");
      if (isSuper && user.active && (await activeSuperAdmins(tx, p.organizationId)).filter((u) => u.id !== user.id).length === 0) {
        throw new AccountError("The system must keep at least one active Super Admin.");
      }
    }
    const updated = await tx.user.update({ where: { id: user.id }, data: { active: p.active } });
    if (!p.active) await tx.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
    return updated;
  });
}

export async function adminResetMfa(db: PrismaClient, p: { organizationId: string; userId: string; actor: Actor }) {
  const user = await db.user.findFirst({ where: { id: p.userId, organizationId: p.organizationId }, include: { roles: { include: { role: true } } } });
  if (!user) throw new AccountError("User not found.");
  if (user.roles.some((r) => r.role.key === "SUPER_ADMIN") && !p.actor.isSuperAdmin) throw new AccountError("Only a Super Admin can reset a Super Admin's two-step verification.");
  await db.user.update({ where: { id: user.id }, data: { totpEnabled: false, totpSecretEnc: null, totpLastStep: null, recoveryCodes: [] } });
  await revokeSessions(db, user.id);
}

// ----- Roles -----

const slug = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40);

function checkGrantable(actor: Actor, keys: string[]) {
  const unknown = keys.filter((k) => !(ALL_PERMISSIONS as string[]).includes(k));
  if (unknown.length) throw new AccountError(`Unknown permission: ${unknown[0]}.`);
  // You cannot give away what you do not have. A Super Admin holds everything.
  if (!actor.isSuperAdmin) {
    const missing = keys.filter((k) => !actor.permissions.has(k));
    if (missing.length) throw new AccountError(`You cannot grant ${missing[0]} because you do not hold it yourself.`);
  }
}

export async function createRole(db: PrismaClient, p: { organizationId: string; name: string; permissionKeys: string[]; actor: Actor }) {
  const name = p.name.trim();
  if (name.length < 2) throw new AccountError("Enter a role name.");
  const key = `CUSTOM_${slug(name)}`;
  if (key === "CUSTOM_") throw new AccountError("Use letters or digits in the role name.");
  checkGrantable(p.actor, p.permissionKeys);
  if (await db.role.findUnique({ where: { organizationId_key: { organizationId: p.organizationId, key } } })) throw new AccountError("A role with this name already exists.");
  const perms = await db.permission.findMany({ where: { key: { in: p.permissionKeys } } });
  return db.role.create({ data: { organizationId: p.organizationId, key, name, isSystem: false, permissions: { create: perms.map((x) => ({ permissionId: x.id })) } } });
}

export async function setRolePermissions(db: PrismaClient, p: { organizationId: string; roleId: string; permissionKeys: string[]; actor: Actor }) {
  const role = await db.role.findFirst({ where: { id: p.roleId, organizationId: p.organizationId }, include: { permissions: { include: { permission: true } } } });
  if (!role) throw new AccountError("Role not found.");
  if (role.key === "SUPER_ADMIN") throw new AccountError("The Super Admin role always holds every permission and cannot be edited.");
  if (EXTERNAL_KEYS.includes(role.key) && p.permissionKeys.length > 0) throw new AccountError("Client, vendor, partner and investor roles use their portals and hold no staff permissions.");
  checkGrantable(p.actor, p.permissionKeys);
  // Removing a permission you do not hold is also blocked: a limited admin must not strip a role they cannot see in full
  if (!p.actor.isSuperAdmin) {
    const removed = role.permissions.map((x) => x.permission.key).filter((k) => !p.permissionKeys.includes(k) && !p.actor.permissions.has(k));
    if (removed.length) throw new AccountError(`You cannot remove ${removed[0]} because you do not hold it yourself.`);
  }
  const perms = await db.permission.findMany({ where: { key: { in: p.permissionKeys } } });
  const before = role.permissions.map((x) => x.permission.key).sort();
  await db.$transaction([
    db.rolePermission.deleteMany({ where: { roleId: role.id } }),
    db.rolePermission.createMany({ data: perms.map((x) => ({ roleId: role.id, permissionId: x.id })) }),
  ]);
  // People holding this role pick up the change at their next sign-in
  const holders = await db.userRole.findMany({ where: { roleId: role.id }, select: { userId: true } });
  await db.session.updateMany({ where: { userId: { in: holders.map((h) => h.userId) }, revokedAt: null }, data: { revokedAt: new Date() } });
  return { before, after: p.permissionKeys.slice().sort(), affectedUsers: holders.length, roleName: role.name };
}

export async function deleteRole(db: PrismaClient, p: { organizationId: string; roleId: string }) {
  const role = await db.role.findFirst({ where: { id: p.roleId, organizationId: p.organizationId }, include: { _count: { select: { users: true } } } });
  if (!role) throw new AccountError("Role not found.");
  if (role.isSystem) throw new AccountError("Built-in roles cannot be deleted.");
  if (role._count.users > 0) throw new AccountError(`${role._count.users} user(s) still hold this role. Move them to another role first.`);
  await db.role.delete({ where: { id: role.id } });
}

export type { PermissionKey };
