"use server";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { markAllRead, markRead } from "@/lib/notifications";

export type BellItem = { id: string; title: string; body: string | null; link: string | null; at: string; read: boolean };

// Latest notifications for the bell panel. No revalidation: the page underneath is left alone.
export async function loadBell(): Promise<{ items: BellItem[]; unread: number }> {
  const user = await requireUser({ allowMustChange: true, allowMfaSetup: true });
  const [rows, unread] = await Promise.all([
    db.notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 15 }),
    db.notification.count({ where: { userId: user.id, readAt: null } }),
  ]);
  return { items: rows.map((n) => ({ id: n.id, title: n.title, body: n.body, link: n.link, at: n.createdAt.toISOString(), read: !!n.readAt })), unread };
}

export async function readBellItem(id: string) {
  const user = await requireUser({ allowMustChange: true, allowMfaSetup: true });
  await markRead(db, user.id, id);
}

export async function readBellAll() {
  const user = await requireUser({ allowMustChange: true, allowMfaSetup: true });
  await markAllRead(db, user.id);
}
