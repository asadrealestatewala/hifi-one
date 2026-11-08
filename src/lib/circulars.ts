// HR circulars. Free of Next.js imports. A circular goes to all active staff, to some roles or to chosen people.
// Each recipient gets a normal in-app notification (and a phone push through notify) plus a popup until they press "I have read this".
import type { PrismaClient } from "@prisma/client";
import { notify } from "./notifications";
import { signDownload } from "./files";

export const CIRCULAR_KINDS = { GENERAL: "General notice", WORK_FROM_HOME: "Work from home", HOLIDAY: "Holiday or leave", POLICY: "Policy change", URGENT: "Urgent" } as const;
export type CircularKind = keyof typeof CIRCULAR_KINDS;
export type CircularAudience = { type: "ALL" } | { type: "ROLES"; roleKeys: string[] } | { type: "PEOPLE"; userIds: string[] };

export class CircularError extends Error {}

export async function sendCircular(db: PrismaClient, i: { id?: string; organizationId: string; sentById: string; kind: string; title: string; body: string; audience: CircularAudience }) {
  const title = i.title.trim(), body = i.body.trim();
  if (!title) throw new CircularError("Give the circular a title.");
  if (!body) throw new CircularError("Write the circular text.");
  if (title.length > 120) throw new CircularError("Keep the title under 120 characters.");
  if (body.length > 4000) throw new CircularError("Keep the text under 4000 characters.");
  const kind = i.kind in CIRCULAR_KINDS ? i.kind : "GENERAL";
  const staff = { organizationId: i.organizationId, active: true, userType: "EMPLOYEE" } as const;
  const now = new Date();
  let ids: string[];
  let label: string;
  if (i.audience.type === "ALL") {
    ids = (await db.user.findMany({ where: staff, select: { id: true } })).map((u) => u.id);
    label = "All staff";
  } else if (i.audience.type === "ROLES") {
    const keys = [...new Set(i.audience.roleKeys)];
    if (keys.length === 0) throw new CircularError("Choose at least one role.");
    const roles = await db.role.findMany({ where: { organizationId: i.organizationId, key: { in: keys } }, select: { name: true } });
    ids = (await db.user.findMany({ where: { ...staff, roles: { some: { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }], role: { organizationId: i.organizationId, key: { in: keys } } } } }, select: { id: true } })).map((u) => u.id);
    label = roles.map((r) => r.name).join(", ");
  } else {
    const want = [...new Set(i.audience.userIds)];
    if (want.length === 0) throw new CircularError("Choose at least one person.");
    ids = (await db.user.findMany({ where: { ...staff, id: { in: want } }, select: { id: true } })).map((u) => u.id); // people outside the organisation or inactive are dropped
    label = `${ids.length} chosen ${ids.length === 1 ? "person" : "people"}`;
  }
  if (ids.length === 0) throw new CircularError("Nobody active matches that audience, so nothing was sent.");
  const c = await db.circular.create({ data: { ...(i.id ? { id: i.id } : {}), organizationId: i.organizationId, kind, title, body, audience: i.audience.type, audienceLabel: label, sentById: i.sentById, recipients: { create: ids.map((userId) => ({ userId })) } } });
  const preview = body.length > 160 ? `${body.slice(0, 157)}…` : body;
  for (const userId of ids) await notify(db, userId, { kind: "circular", title: `${kind === "URGENT" ? "Urgent: " : "Circular: "}${title}`, body: preview, link: "/me/circulars", dedupeKey: `circular:${c.id}` });
  return { id: c.id, recipients: ids.length };
}

export type CircularAttachment = { id: string; name: string; url: string; image: boolean };
export type CircularCard = { id: string; kind: string; title: string; body: string; at: string; acknowledged: boolean; from: string; attachments: CircularAttachment[] };

// Links are signed for this person and expire after ten minutes, so they are made fresh each time the list is loaded.
export async function circularAttachments(db: PrismaClient, userId: string, circularIds: string[]): Promise<Map<string, CircularAttachment[]>> {
  const out = new Map<string, CircularAttachment[]>();
  if (circularIds.length === 0) return out;
  const secret = process.env.SESSION_SECRET ?? "";
  const files = await db.storedFile.findMany({ where: { ownerType: "CIRCULAR", ownerId: { in: circularIds }, deletedAt: null }, orderBy: { createdAt: "asc" } });
  for (const f of files) out.set(f.ownerId, [...(out.get(f.ownerId) ?? []), { id: f.id, name: f.filename, url: `/api/files/${f.id}?t=${signDownload(f.id, userId, secret)}`, image: f.contentType.startsWith("image/") }]);
  return out;
}

async function cards(db: PrismaClient, userId: string, onlyOpen: boolean, take: number): Promise<CircularCard[]> {
  const rows = await db.circularRecipient.findMany({ where: { userId, ...(onlyOpen ? { ackAt: null } : {}) }, orderBy: { circular: { createdAt: "desc" } }, take, include: { circular: true } });
  const senders = new Map((await db.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.circular.sentById))] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const files = await circularAttachments(db, userId, rows.map((r) => r.circular.id));
  return rows.map((r) => ({ attachments: files.get(r.circular.id) ?? [], id: r.circular.id, kind: r.circular.kind, title: r.circular.title, body: r.circular.body, at: r.circular.createdAt.toISOString(), acknowledged: !!r.ackAt, from: senders.get(r.circular.sentById) ?? "HR" }));
}
export const openCirculars = (db: PrismaClient, userId: string) => cards(db, userId, true, 10);
export const myCirculars = (db: PrismaClient, userId: string) => cards(db, userId, false, 100);

// Only the recipient can acknowledge, and doing it twice changes nothing. The matching bell notification is marked read too.
export async function acknowledgeCircular(db: PrismaClient, userId: string, circularId: string) {
  const r = await db.circularRecipient.updateMany({ where: { circularId, userId, ackAt: null }, data: { ackAt: new Date() } });
  if (r.count) await db.notification.updateMany({ where: { userId, dedupeKey: `circular:${circularId}`, readAt: null }, data: { readAt: new Date() } });
  return r.count > 0;
}

export async function circularReport(db: PrismaClient, organizationId: string, circularId: string) {
  const c = await db.circular.findFirst({ where: { id: circularId, organizationId } });
  if (!c) return null;
  const rows = await db.circularRecipient.findMany({ where: { circularId }, select: { userId: true, ackAt: true } });
  const people = new Map((await db.user.findMany({ where: { id: { in: rows.map((r) => r.userId) } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const list = rows.map((r) => ({ userId: r.userId, name: people.get(r.userId) ?? "Former staff", ackAt: r.ackAt })).sort((a, b) => Number(!!a.ackAt) - Number(!!b.ackAt) || a.name.localeCompare(b.name));
  return { circular: c, recipients: list, acknowledged: list.filter((r) => r.ackAt).length };
}
