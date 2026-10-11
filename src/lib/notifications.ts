// In-app notifications. Free of Next.js imports. A dedupe key makes retried events notify only once.
import { Prisma, type PrismaClient } from "@prisma/client";

export type NotifyInput = { kind: string; title: string; body?: string; link?: string; dedupeKey?: string };

export async function notify(db: PrismaClient, userId: string, n: NotifyInput) {
  try {
    await db.notification.create({ data: { userId, kind: n.kind, title: n.title, body: n.body ?? null, link: n.link ?? null, dedupeKey: n.dedupeKey ?? null } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return; // already sent
    throw e;
  }
}

export async function notifyMany(db: PrismaClient, userIds: string[], n: NotifyInput) {
  for (const id of new Set(userIds)) await notify(db, id, n);
}

// Everyone in the organization whose active roles include the permission.
export async function usersWithPermission(db: PrismaClient, organizationId: string, permission: string, exceptUserId?: string) {
  const users = await db.user.findMany({
    where: {
      organizationId, active: true, userType: "EMPLOYEE", ...(exceptUserId ? { id: { not: exceptUserId } } : {}),
      roles: { some: { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }], role: { permissions: { some: { permission: { key: permission } } } } } },
    },
    select: { id: true },
  });
  return users.map((u) => u.id);
}

export async function notifyPermission(db: PrismaClient, organizationId: string, permission: string, n: NotifyInput, exceptUserId?: string) {
  await notifyMany(db, await usersWithPermission(db, organizationId, permission, exceptUserId), n);
}

export const unreadCount = (db: PrismaClient, userId: string) => db.notification.count({ where: { userId, readAt: null } });

// Users can only mark their own notifications as read.
export const markRead = (db: PrismaClient, userId: string, id: string) =>
  db.notification.updateMany({ where: { id, userId, readAt: null }, data: { readAt: new Date() } });

export const markAllRead = (db: PrismaClient, userId: string) => db.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } });
