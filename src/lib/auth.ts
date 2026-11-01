import { cache } from "react";
import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { db } from "./db";
import { limiter } from "./rate-limit";
import { checkSecondFactor } from "./mfa";
import { needsMfaSetup } from "./mfa-policy";
import { parseLoginIdentifier } from "./login-identifier";
import { signInBlock } from "./onboarding";
import type { PermissionKey } from "./permissions";

const COOKIE = "hifi_session";
const SESSION_HOURS = 12;
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET must be set (32+ characters)");
  return new TextEncoder().encode(s);
}

export type SessionUser = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  organizationId: string;
  userType: string;
  mustChangePassword: boolean;
  clientId: string | null;
  vendorId: string | null;
  permissions: Set<PermissionKey>;
  roles: string[];
  roleKeys: string[];
  totpEnabled: boolean;
  mfaRequired: boolean;
};

const MFA_COOKIE = "hifi_mfa_pending";

type LoginResult = { ok: true; mfa?: boolean; userType: string } | { ok: false; error: string };

async function startSession(user: { id: string; organizationId: string }) {
  const h = await headers();
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 3600_000);
  const session = await db.session.create({
    data: { userId: user.id, expiresAt, userAgent: h.get("user-agent"), ip: h.get("x-forwarded-for") },
  });
  await db.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } });
  await db.auditLog.create({
    data: { organizationId: user.organizationId, actorId: user.id, action: "auth.login", entity: "Session", entityId: session.id },
  });
  const token = await new SignJWT({ sid: session.id }).setProtectedHeader({ alg: "HS256" }).setExpirationTime(expiresAt).sign(secret());
  (await cookies()).set(COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", expires: expiresAt });
}

// Sign in with the registered email or registered contact number, plus the password. The identifier is normalised
// first, so "+92 300 1234567", "03001234567" and "+923001234567" all find the same account. Messages never say
// which part was wrong, and attempts are limited per address and per identifier.
export async function login(identifier: string, password: string): Promise<LoginResult> {
  const generic = { ok: false as const, error: "Invalid email, phone number or password." };
  const id = parseLoginIdentifier(identifier);
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0].trim() ?? "local";
  if (!limiter("login-ip", 20, 10 * 60_000).take(ip) || !limiter("login-email", 8, 10 * 60_000).take(id?.value ?? identifier.trim().toLowerCase())) {
    return { ok: false, error: "Too many sign-in attempts. Please wait a few minutes and try again." };
  }
  if (!id) return generic;
  const user = await db.user.findUnique({ where: id.kind === "email" ? { email: id.value } : { phone: id.value } });
  if (!user || !user.active) return generic;
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    return { ok: false, error: "Account temporarily locked after repeated failed sign-ins. Try again later." };
  }
  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    const failed = user.failedLogins + 1;
    await db.user.update({
      where: { id: user.id },
      data: failed >= MAX_FAILED ? { failedLogins: 0, lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60_000) } : { failedLogins: failed },
    });
    await db.auditLog.create({ data: { organizationId: user.organizationId, actorId: user.id, action: "auth.login_failed", entity: "User", entityId: user.id } });
    return generic;
  }
  // New staff accounts wait for a verified email and an approver (src/lib/onboarding.ts). Said only after the password was right.
  const pending = await signInBlock(db, user.id);
  if (pending) return { ok: false, error: pending };
  if (user.totpEnabled) {
    // Password is right, but no session exists until the second factor is proven. The pending cookie only proves step one.
    const token = await new SignJWT({ uid: user.id, purpose: "mfa" }).setProtectedHeader({ alg: "HS256" }).setExpirationTime("5m").sign(secret());
    (await cookies()).set(MFA_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 300 });
    return { ok: true, mfa: true, userType: user.userType };
  }
  await startSession(user);
  return { ok: true, userType: user.userType };
}

// Step two of sign-in for accounts with an authenticator app. Accepts a 6-digit code or one recovery code.
export async function completeMfaLogin(code: string): Promise<{ ok: true } | { ok: false; error: string; restart?: boolean }> {
  const jar = await cookies();
  const pending = jar.get(MFA_COOKIE)?.value;
  let uid: string;
  try {
    const { payload } = await jwtVerify(pending ?? "", secret());
    if (payload.purpose !== "mfa") throw new Error("wrong purpose");
    uid = String(payload.uid);
  } catch {
    return { ok: false, error: "Your sign-in timed out. Please start again.", restart: true };
  }
  if (!limiter("mfa-user", 6, 10 * 60_000).take(uid)) return { ok: false, error: "Too many attempts. Please wait a few minutes and try again." };
  const user = await db.user.findUnique({ where: { id: uid } });
  if (!user || !user.active || !user.totpEnabled) return { ok: false, error: "Your sign-in timed out. Please start again.", restart: true };
  const result = await checkSecondFactor(db, user, code, process.env.SESSION_SECRET ?? "");
  if (!result.ok) {
    await db.auditLog.create({ data: { organizationId: user.organizationId, actorId: user.id, action: "auth.mfa_failed", entity: "User", entityId: user.id } });
    return { ok: false, error: "That code is not correct." };
  }
  jar.delete(MFA_COOKIE);
  if (result.usedRecoveryCode) await db.auditLog.create({ data: { organizationId: user.organizationId, actorId: user.id, action: "auth.recovery_code_used", entity: "User", entityId: user.id } });
  await startSession(user);
  return { ok: true };
}

export async function logout() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) {
    try {
      const { payload } = await jwtVerify(token, secret());
      await db.session.updateMany({ where: { id: String(payload.sid) }, data: { revokedAt: new Date() } });
    } catch {
      // invalid token: nothing to revoke
    }
  }
  jar.delete(COOKIE);
}

async function loadSessionUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  let sid: string;
  try {
    sid = String((await jwtVerify(token, secret())).payload.sid);
  } catch {
    return null;
  }
  const session = await db.session.findUnique({
    where: { id: sid },
    include: {
      user: {
        include: {
          roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
        },
      },
    },
  });
  if (!session || session.revokedAt || session.expiresAt < new Date() || !session.user.active) return null;
  const now = new Date();
  const activeRoles = session.user.roles.filter((r) => !r.expiresAt || r.expiresAt > now);
  const permissions = new Set<PermissionKey>();
  for (const ur of activeRoles) {
    for (const rp of ur.role.permissions) permissions.add(rp.permission.key as PermissionKey);
  }
  return {
    id: session.user.id,
    name: session.user.name,
    email: session.user.email,
    phone: session.user.phone,
    organizationId: session.user.organizationId,
    userType: session.user.userType,
    mustChangePassword: session.user.mustChangePassword,
    clientId: session.user.clientId,
    vendorId: session.user.vendorId,
    permissions,
    roles: activeRoles.map((r) => r.role.name),
    roleKeys: activeRoles.map((r) => r.role.key),
    totpEnabled: session.user.totpEnabled,
    mfaRequired: activeRoles.some((r) => r.role.requireMfa),
  };
}

// One lookup per request: the layout and the page both ask, but the database is only asked once.
export const getSessionUser = cache(loadSessionUser);

// Internal pages: employees only. Portal users are sent to their own portal.
export async function requireUser(opts: { allowMustChange?: boolean; allowMfaSetup?: boolean } = {}): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  // A starting or reset password must be replaced before anything else is usable
  if (user.mustChangePassword && !opts.allowMustChange && user.userType === "EMPLOYEE") redirect("/account/password?force=1");
  // A role that requires two-step verification blocks everything except setting it up
  if (needsMfaSetup(user) && !opts.allowMfaSetup) redirect("/account/security?required=1");
  if (user.userType === "CLIENT") redirect("/portal");
  if (user.userType === "VENDOR") redirect("/vendor");
  if (user.userType !== "EMPLOYEE") redirect("/forbidden");
  return user;
}

// Vendor portal pages: only a vendor user bound to exactly one vendor record.
export async function requireVendorUser(): Promise<SessionUser & { vendorId: string }> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.userType !== "VENDOR" || !user.vendorId) redirect("/forbidden");
  return user as SessionUser & { vendorId: string };
}

// Client portal pages: only a client user bound to exactly one client record.
export async function requireClientUser(): Promise<SessionUser & { clientId: string }> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.userType !== "CLIENT" || !user.clientId) redirect("/forbidden");
  return user as SessionUser & { clientId: string };
}

// Server-side authorization: call at the top of every protected page and action.
export async function requirePermission(permission: PermissionKey): Promise<SessionUser> {
  const user = await requireUser();
  if (!user.permissions.has(permission)) redirect("/forbidden");
  return user;
}

export async function audit(
  user: SessionUser,
  entry: { action: string; entity: string; entityId?: string; before?: unknown; after?: unknown },
) {
  await db.auditLog.create({
    data: {
      organizationId: user.organizationId,
      actorId: user.id,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId,
      before: entry.before as never,
      after: entry.after as never,
    },
  });
}

// The identity used by user and role administration rules (see accounts.ts)
export const toActor = (u: SessionUser) => ({ id: u.id, isSuperAdmin: u.roleKeys.includes("SUPER_ADMIN"), permissions: u.permissions as ReadonlySet<string> });

// Any signed-in person of any type (staff, client, vendor). Used where access is decided by the record, not by the person's area.
export async function requireSession(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (needsMfaSetup(user)) redirect("/account/security?required=1");
  return user;
}

export const toFileActor = (u: SessionUser) => ({
  id: u.id, organizationId: u.organizationId, userType: u.userType, clientId: u.clientId, vendorId: u.vendorId, permissions: u.permissions as ReadonlySet<string>,
});
