import { db } from "@/lib/db";
import { markAllRead, markRead } from "@/lib/notifications";
import { isResponse, json, readJson, requireMobileUser, str } from "@/lib/mobile-api";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const a = await requireMobileUser(req);
  if (isResponse(a)) return a;
  const rows = await db.notification.findMany({ where: { userId: a.user.id }, orderBy: { createdAt: "desc" }, take: 50 });
  return json({
    unread: rows.filter((n) => !n.readAt).length,
    notifications: rows.map((n) => ({ id: n.id, kind: n.kind, title: n.title, body: n.body, link: n.link, read: !!n.readAt, createdAt: n.createdAt.toISOString() })),
  });
}

// { id } marks one of your notifications read; { all: true } marks every one read.
export async function POST(req: Request) {
  const a = await requireMobileUser(req);
  if (isResponse(a)) return a;
  const body = await readJson(req);
  if (body.all === true) await markAllRead(db, a.user.id);
  else if (str(body.id, 60)) await markRead(db, a.user.id, str(body.id, 60));
  else return json({ error: "Nothing to mark." }, 400);
  return json({ ok: true });
}
