// Content calendar service: versions, the approval workflow, and the people notified at each step.
// Free of Next.js imports so it can be tested against the database.
import type { PrismaClient } from "@prisma/client";
import { PLATFORMS, POST_TYPES, canTransition, isDate, isEditable, isTime, needsComment, type Actor } from "./content-rules";
import { notifyMany } from "./notifications";

export class ContentError extends Error {}

export type ContentActor = { id: string; type: Actor; clientId?: string | null };

// `platform` (one) is accepted as shorthand for `platforms`, and the post type defaults to a static post
export type PostFields = { platforms?: string[]; platform?: string; postType?: string; plannedDate?: string; plannedTime?: string };

function checkFields(p: PostFields) {
  const platforms = [...new Set(p.platforms ?? (p.platform ? [p.platform] : []))];
  if (platforms.length === 0) throw new ContentError("Choose at least one platform.");
  if (platforms.some((x) => !(PLATFORMS as readonly string[]).includes(x))) throw new ContentError("Choose platforms from the list.");
  const postType = p.postType ?? "STATIC";
  if (!(POST_TYPES as readonly string[]).includes(postType)) throw new ContentError("Choose a post type.");
  if (p.plannedDate && !isDate(p.plannedDate)) throw new ContentError("Enter a valid posting date.");
  if (p.plannedTime && !isTime(p.plannedTime)) throw new ContentError("Enter a valid posting time.");
  if (p.plannedTime && !p.plannedDate) throw new ContentError("Choose the posting date as well as the time.");
  return platforms;
}


export async function createContent(
  db: PrismaClient,
  p: PostFields & { organizationId: string; clientId?: string | null; projectId?: string | null; title: string; copy: string; hashtags?: string; assignedToId?: string | null; createdById: string },
) {
  const platforms = checkFields(p);
  if (p.title.trim().length < 2) throw new ContentError("Enter a title.");
  if (p.copy.length > 5000) throw new ContentError("The caption is too long.");
  if (p.clientId && !(await db.client.findFirst({ where: { id: p.clientId, organizationId: p.organizationId } }))) throw new ContentError("Choose a client.");
  if (p.assignedToId && !(await db.user.findFirst({ where: { id: p.assignedToId, organizationId: p.organizationId, active: true, userType: "EMPLOYEE" } }))) throw new ContentError("Choose a staff member to assign it to.");
  return db.contentItem.create({
    data: {
      organizationId: p.organizationId, clientId: p.clientId || null, projectId: p.projectId || null, platform: platforms[0], platforms, postType: p.postType ?? "STATIC", title: p.title.trim(), copy: p.copy,
      hashtags: p.hashtags || null, plannedDate: p.plannedDate || null, plannedTime: p.plannedTime || null, assignedToId: p.assignedToId || null, createdById: p.createdById,
      versions: { create: { version: 1, copy: p.copy, hashtags: p.hashtags || null } },
      events: { create: { actorId: p.createdById, actorType: "STAFF", toStatus: "DRAFT" } },
    },
  });
}

// Moving a post to another day (drag on the calendar). Allowed in any status except Published; the approved wording is untouched, so no new version.
export async function reschedule(db: PrismaClient, p: { organizationId: string; id: string; plannedDate: string; plannedTime?: string | null }) {
  if (!isDate(p.plannedDate)) throw new ContentError("Enter a valid date.");
  if (p.plannedTime && !isTime(p.plannedTime)) throw new ContentError("Enter a valid time.");
  const item = await db.contentItem.findFirst({ where: { id: p.id, organizationId: p.organizationId } });
  if (!item) throw new ContentError("Content not found.");
  if (item.status === "PUBLISHED") throw new ContentError("A published post cannot be moved.");
  return db.contentItem.update({ where: { id: item.id }, data: { plannedDate: p.plannedDate, ...(p.plannedTime !== undefined ? { plannedTime: p.plannedTime || null } : {}) } });
}

// Every copy change is a new version, so what the client approved can always be shown.
export async function editContent(db: PrismaClient, p: { organizationId: string; id: string; copy: string; hashtags?: string; title?: string; plannedDate?: string; plannedTime?: string; postType?: string; platforms?: string[] }) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "ContentItem" WHERE id = ${p.id} FOR UPDATE`;
    const item = await tx.contentItem.findFirst({ where: { id: p.id, organizationId: p.organizationId } });
    if (!item) throw new ContentError("Content not found.");
    if (!isEditable(item.status)) throw new ContentError("This content is with the client or already approved. Withdraw it before editing.");
    if (p.copy.trim().length < 1) throw new ContentError("The post copy cannot be empty.");
    const fields = checkFields({ platforms: p.platforms ?? item.platforms, postType: p.postType ?? item.postType, plannedDate: p.plannedDate ?? item.plannedDate ?? undefined, plannedTime: p.plannedTime ?? item.plannedTime ?? undefined });
    const changed = p.copy !== item.copy || (p.hashtags ?? "") !== (item.hashtags ?? "");
    const version = changed ? item.version + 1 : item.version;
    if (changed) await tx.contentVersion.create({ data: { itemId: item.id, version, copy: p.copy, hashtags: p.hashtags || null } });
    return tx.contentItem.update({
      where: { id: item.id },
      data: { copy: p.copy, hashtags: p.hashtags || null, version, title: p.title?.trim() || item.title, plannedDate: p.plannedDate || item.plannedDate, plannedTime: p.plannedTime === undefined ? item.plannedTime : p.plannedTime || null, postType: p.postType ?? item.postType, platforms: fields, platform: fields[0] },
    });
  });
}

export async function transition(db: PrismaClient, p: { organizationId: string; id: string; actor: ContentActor; to: string; comment?: string }) {
  const result = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "ContentItem" WHERE id = ${p.id} FOR UPDATE`;
    const item = await tx.contentItem.findFirst({ where: { id: p.id, organizationId: p.organizationId } });
    if (!item) throw new ContentError("Content not found.");
    if (p.actor.type === "CLIENT" && (!p.actor.clientId || !item.clientId || item.clientId !== p.actor.clientId)) throw new ContentError("Content not found."); // another client's item looks like it does not exist
    if (!canTransition(p.actor.type, item.status, p.to, Boolean(item.clientId))) throw new ContentError(`That change is not allowed from ${item.status.toLowerCase().replace("_", " ")}.`);
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
  if (p.to === "CLIENT_REVIEW" && item.clientId) {
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
