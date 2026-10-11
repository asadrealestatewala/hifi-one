import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { db } from "./db";
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
  email: string;
  organizationId: string;
  userType: string;
  clientId: string | null;
  permissions: Set<PermissionKey>;
  roles: string[];
};

export async function login(
  email: string,
  password: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const generic = { ok: false as const, error: "Invalid email or password." };
  const user = await db.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (!user || !user.active) return generic;
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    return { ok: false, error: "Account temporarily locked after repeated failed sign-ins. Try again later." };
  }
  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    const failed = user.failedLogins + 1;
    await db.user.update({
      where: { id: user.id },
      data:
        failed >= MAX_FAILED
          ? { failedLogins: 0, lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60_000) }
          : { failedLogins: failed },
    });
    await db.auditLog.create({
      data: { organizationId: user.organizationId, actorId: user.id, action: "auth.login_failed", entity: "User", entityId: user.id },
    });
    return generic;
  }
  const h = await headers();
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 3600_000);
  const session = await db.session.create({
    data: { userId: user.id, expiresAt, userAgent: h.get("user-agent"), ip: h.get("x-forwarded-for") },
  });
  await db.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } });
  await db.auditLog.create({
    data: { organizationId: user.organizationId, actorId: user.id, action: "auth.login", entity: "Session", entityId: session.id },
  });
  const token = await new SignJWT({ sid: session.id })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(expiresAt)
    .sign(secret());
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
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

export async function getSessionUser(): Promise<SessionUser | null> {
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
    organizationId: session.user.organizationId,
    userType: session.user.userType,
    clientId: session.user.clientId,
    permissions,
    roles: activeRoles.map((r) => r.role.name),
  };
}

// Internal pages: employees only. Portal users are sent to their own portal.
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.userType !== "EMPLOYEE") redirect("/portal");
  return user;
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
