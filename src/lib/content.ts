// Content calendar service: versions, the approval workflow, and the people notified at each step.
// Free of Next.js imports so it can be tested against the database.
import type { PrismaClient } from "@prisma/client";
import { PLATFORMS, canTransition, isEditable, needsComment, type Actor } from "./content-rules";
import { notifyMany } from "./notifications";

export class ContentError extends Error {}

export type ContentActor = { id: string; type: Actor; clientId?: string | null };

export async function createContent(
  db: PrismaClient,
  p: { organizationId: string; clientId: string; projectId?: string | null; platform: string; title: string; copy: string; hashtags?: string; plannedDate?: string; assignedToId?: string | null; createdById: string },
) {
  if (!(PLATFORMS as readonly string[]).includes(p.platform)) throw new ContentError("Choose a platform.");
  if (p.title.trim().length < 2 || p.copy.trim().length < 1) throw new ContentError("Enter a title and the post copy.");
  if (p.plannedDate && !/^\d{4}-\d{2}-\d{2}$/.test(p.plannedDate)) throw new ContentError("Enter a valid planned date.");
  if (!(await db.client.findFirst({ where: { id: p.clientId, organizationId: p.organizationId } }))) throw new ContentError("Choose a client.");
  return db.contentItem.create({
    data: {
      organizationId: p.organizationId, clientId: p.clientId, projectId: p.projectId || null, platform: p.platform, title: p.title.trim(), copy: p.copy,
      hashtags: p.hashtags || null, plannedDate: p.plannedDate || null, assignedToId: p.assignedToId || null, createdById: p.createdById,
      versions: { create: { version: 1, copy: p.copy, hashtags: p.hashtags || null } },
      events: { create: { actorId: p.createdById, actorType: "STAFF", toStatus: "DRAFT" } },
    },
  });
}

// Every copy change is a new version, so what the client approved can always be shown.
export async function editContent(db: PrismaClient, p: { organizationId: string; id: string; copy: string; hashtags?: string; title?: string; plannedDate?: string }) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "ContentItem" WHERE id = ${p.id} FOR UPDATE`;
    const item = await tx.contentItem.findFirst({ where: { id: p.id, organizationId: p.organizationId } });
    if (!item) throw new ContentError("Content not found.");
    if (!isEditable(item.status)) throw new ContentError("This content is with the client or already approved. Withdraw it before editing.");
    if (p.copy.trim().length < 1) throw new ContentError("The post copy cannot be empty.");
    const changed = p.copy !== item.copy || (p.hashtags ?? "") !== (item.hashtags ?? "");
    const version = changed ? item.version + 1 : item.version;
    if (changed) await tx.contentVersion.create({ data: { itemId: item.id, version, copy: p.copy, hashtags: p.hashtags || null } });
    return tx.contentItem.update({
      where: { id: item.id },
      data: { copy: p.copy, hashtags: p.hashtags || null, version, title: p.title?.trim() || item.title, plannedDate: p.plannedDate || item.plannedDate },
    });
  });
}

export async function transition(db: PrismaClient, p: { organizationId: string; id: string; actor: ContentActor; to: string; comment?: string }) {
  const result = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "ContentItem" WHERE id = ${p.id} FOR UPDATE`;
    const item = await tx.contentItem.findFirst({ where: { id: p.id, organizationId: p.organizationId } });
    if (!item) throw new ContentError("Content not found.");
    if (p.actor.type === "CLIENT" && (!p.actor.clientId || item.clientId !== p.actor.clientId)) throw new ContentError("Content not found."); // another client's item looks like it does not exist
    if (!canTransition(p.actor.type, item.status, p.to)) throw new ContentError(`That change is not allowed from ${item.status.toLowerCase().replace("_", " ")}.`);
    const comment = p.comment?.trim() || null;
    if (needsComment(item.status, p.to) && !comment) throw new ContentError("Please give a reason.");
    // Internal review must be done by someone other than the author
    if (item.status === "INTERNAL_REVIEW" && p.to === "CLIENT_REVIEW" && item.createdById === p.actor.id) {
      throw new ContentError("Someone other than the author must complete the internal review.");
    }
    const updated = await tx.contentItem.update({ where: { id: item.id }, data: { status: p.to } });
    await tx.contentEvent.create({ data: { itemId: item.id, actorId: p.actor.id, actorType: p.actor.type, fromStatus: item.status, toStatus: p.to, comment } });
    return { item: updated, from: item.status, comment };
  });

  // Notifications after the change is saved (idempotent per item and status)
  const { item, comment } = result;
  const key = `content:${item.id}:${item.version}:${p.to}`;
  if (p.to === "CLIENT_REVIEW") {
    const clientUsers = await db.user.findMany({ where: { clientId: item.clientId, active: true }, select: { id: true } });
    await notifyMany(db, clientUsers.map((u) => u.id), { kind: "content.review", title: "Content waiting for your approval", body: item.title, link: "/portal/content", dedupeKey: key });
  }
  if (p.actor.type === "CLIENT") {
    const staff = [item.createdById, item.assignedToId].filter((x): x is string => Boolean(x));
    await notifyMany(db, staff, {
      kind: "content.decision", title: p.to === "APPROVED" ? "Client approved content" : "Client requested changes", body: `${item.title}${comment ? `: ${comment}` : ""}`,
      link: `/content/${item.id}`, dedupeKey: key,
    });
  }
  return item;
}

export function clientContent(db: PrismaClient, clientId: string) {
  // Clients never see drafts or internal review
  return db.contentItem.findMany({
    where: { clientId, status: { in: ["CLIENT_REVIEW", "CHANGES_REQUESTED", "APPROVED", "SCHEDULED", "PUBLISHED"] } },
    orderBy: [{ plannedDate: "asc" }, { createdAt: "desc" }],
    select: { id: true, platform: true, title: true, copy: true, hashtags: true, plannedDate: true, status: true, version: true },
  });
}
