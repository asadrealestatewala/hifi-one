// Content calendar service: versions, the approval workflow, and the people notified at each step.
// Free of Next.js imports so it can be tested against the database.
import type { PrismaClient } from "@prisma/client";
import { PLATFORMS, POST_TYPES, canTransition, captionIssues, cleanPlatformCopy, isDate, isEditable, isTime, needsComment, type Actor, type PlatformCopy } from "./content-rules";
import { notifyMany } from "./notifications";
import { QUOTA_LABEL, logUsage, currentPeriod } from "./engagements";
import { taskAssigned } from "./events";

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
  p: PostFields & { organizationId: string; clientId?: string | null; projectId?: string | null; title: string; copy: string; hashtags?: string; assignedToId?: string | null; createdById: string; brief?: string; sampleUrl?: string },
) {
  const platforms = checkFields(p);
  if (p.title.trim().length < 2) throw new ContentError("Enter a title.");
  if (p.copy.length > 5000) throw new ContentError("The caption is too long.");
  if (p.clientId && !(await db.client.findFirst({ where: { id: p.clientId, organizationId: p.organizationId } }))) throw new ContentError("Choose a client.");
  if (p.assignedToId && !(await db.user.findFirst({ where: { id: p.assignedToId, organizationId: p.organizationId, active: true, userType: "EMPLOYEE" } }))) throw new ContentError("Choose a staff member to assign it to.");
  const sample = p.sampleUrl?.trim() ?? "";
  if (sample) { let ok = false; try { ok = ["https:", "http:"].includes(new URL(sample).protocol); } catch { ok = false; } if (!ok || sample.length > 500) throw new ContentError("Enter the sample as a web link."); }
  if ((p.brief ?? "").length > 3000) throw new ContentError("The brief is too long.");
  const item = await db.contentItem.create({
    data: {
      brief: p.brief?.trim() || null, sampleUrl: sample || null,
      organizationId: p.organizationId, clientId: p.clientId || null, projectId: p.projectId || null, platform: platforms[0], platforms, postType: p.postType ?? "STATIC", title: p.title.trim(), copy: p.copy,
      hashtags: p.hashtags || null, plannedDate: p.plannedDate || null, plannedTime: p.plannedTime || null, assignedToId: p.assignedToId || null, createdById: p.createdById,
      versions: { create: { version: 1, copy: p.copy, hashtags: p.hashtags || null } },
      events: { create: { actorId: p.createdById, actorType: "STAFF", toStatus: "DRAFT" } },
    },
  });
  // The person asked to make it gets a project task as well, on the client's active project when there is one, so it shows in their task list.
  if (item.assignedToId && item.clientId) {
    const project = p.projectId ? await db.project.findFirst({ where: { id: p.projectId, organizationId: p.organizationId } }) : await db.project.findFirst({ where: { organizationId: p.organizationId, clientId: item.clientId, status: "ACTIVE" }, orderBy: { createdAt: "asc" } });
    if (project) {
      const task = await db.task.create({
        data: {
          projectId: project.id, title: `Create: ${item.title}`, status: "TODO", assigneeId: item.assignedToId, createdById: p.createdById, dueDate: item.plannedDate ? new Date(item.plannedDate + "T00:00:00Z") : null,
          description: [item.brief, item.sampleUrl ? `Sample: ${item.sampleUrl}` : null, `Content calendar entry: /content/${item.id}`].filter(Boolean).join("\n\n"),
        },
      });
      await db.contentItem.update({ where: { id: item.id }, data: { taskId: task.id } });
      await taskAssigned(db, { organizationId: p.organizationId, taskId: task.id, toUserId: item.assignedToId, byUserId: p.createdById }).catch(() => undefined);
    }
  }
  return item;
}

// The kind of work a published post counts as against a retainer's quota.
export const QUOTA_FOR_POST: Record<string, string> = { REEL: "REEL", VIDEO: "LONG_VIDEO", LIVE: "LONG_VIDEO", STATIC: "STATIC_CREATIVE", CAROUSEL: "STATIC_CREATIVE", STORY: "STATIC_CREATIVE" };

// A published post counts once against the client's active retainer that includes that kind of work. Never blocks publishing.
export async function countPublishedAgainstQuota(db: PrismaClient, item: { id: string; organizationId: string; clientId: string | null; postType: string; title: string }, actorId: string) {
  const key = QUOTA_FOR_POST[item.postType];
  if (!key || !item.clientId) return false;
  const e = await db.engagement.findFirst({ where: { organizationId: item.organizationId, clientId: item.clientId, status: "ACTIVE", quotas: { some: { key } } }, orderBy: { createdAt: "asc" } });
  if (!e) return false;
  if (await db.quotaUsage.findFirst({ where: { contentItemId: item.id, key } })) return false;
  try {
    const u = await logUsage(db, { organizationId: item.organizationId, engagementId: e.id, key, quantity: 1, period: currentPeriod(), note: `Published: ${item.title} (${QUOTA_LABEL[key]})`, actorId });
    await db.quotaUsage.update({ where: { id: u.id }, data: { contentItemId: item.id } });
    return true;
  } catch { return false; }
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
// platformCopy and firstComment: undefined keeps what is there. A platform caption equal to the main caption is dropped.
export async function editContent(db: PrismaClient, p: { organizationId: string; id: string; copy: string; hashtags?: string; title?: string; plannedDate?: string; plannedTime?: string; postType?: string; platforms?: string[]; platformCopy?: PlatformCopy; firstComment?: string; brief?: string }) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "ContentItem" WHERE id = ${p.id} FOR UPDATE`;
    const item = await tx.contentItem.findFirst({ where: { id: p.id, organizationId: p.organizationId } });
    if (!item) throw new ContentError("Content not found.");
    if (!isEditable(item.status)) throw new ContentError("This content is with the client or already approved. Withdraw it before editing.");
    if (p.copy.trim().length < 1) throw new ContentError("The post copy cannot be empty.");
    const fields = checkFields({ platforms: p.platforms ?? item.platforms, postType: p.postType ?? item.postType, plannedDate: p.plannedDate ?? item.plannedDate ?? undefined, plannedTime: p.plannedTime ?? item.plannedTime ?? undefined });
    const pc = p.platformCopy === undefined ? cleanPlatformCopy(item.platformCopy) : Object.fromEntries(Object.entries(cleanPlatformCopy(p.platformCopy)).filter(([k, v]) => fields.includes(k) && v.trim() !== p.copy.trim()));
    if (Object.values(pc).some((v) => v.length > 5000)) throw new ContentError("A platform caption is too long.");
    const firstComment = p.firstComment === undefined ? item.firstComment : p.firstComment.trim() || null;
    if ((firstComment ?? "").length > 2200) throw new ContentError("The first comment is too long.");
    if (p.brief !== undefined && p.brief.length > 3000) throw new ContentError("The brief is too long.");
    const changed = p.copy !== item.copy || (p.hashtags ?? "") !== (item.hashtags ?? "") || JSON.stringify(pc) !== JSON.stringify(cleanPlatformCopy(item.platformCopy)) || firstComment !== item.firstComment;
    const version = changed ? item.version + 1 : item.version;
    if (changed) await tx.contentVersion.create({ data: { itemId: item.id, version, copy: p.copy, hashtags: p.hashtags || null, platformCopy: pc, firstComment } });
    return tx.contentItem.update({
      where: { id: item.id },
      data: { copy: p.copy, hashtags: p.hashtags || null, platformCopy: pc, firstComment, ...(p.brief !== undefined ? { brief: p.brief.trim() || null } : {}), version, title: p.title?.trim() || item.title, plannedDate: p.plannedDate || item.plannedDate, plannedTime: p.plannedTime === undefined ? item.plannedTime : p.plannedTime || null, postType: p.postType ?? item.postType, platforms: fields, platform: fields[0] },
    });
  });
}

// quiet: the caller sends one summary notification itself (bulk moves)
export async function transition(db: PrismaClient, p: { organizationId: string; id: string; actor: ContentActor; to: string; comment?: string; quiet?: boolean }) {
  const result = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "ContentItem" WHERE id = ${p.id} FOR UPDATE`;
    const item = await tx.contentItem.findFirst({ where: { id: p.id, organizationId: p.organizationId } });
    if (!item) throw new ContentError("Content not found.");
    if (p.actor.type === "CLIENT" && (!p.actor.clientId || !item.clientId || item.clientId !== p.actor.clientId)) throw new ContentError("Content not found."); // another client's item looks like it does not exist
    if (!canTransition(p.actor.type, item.status, p.to, Boolean(item.clientId))) throw new ContentError(`That change is not allowed from ${item.status.toLowerCase().replace("_", " ")}.`);
    const comment = p.comment?.trim() || null;
    if (needsComment(item.status, p.to) && !comment) throw new ContentError("Please give a reason.");
    // A caption a platform would reject never reaches the client (or approval, for our own posts)
    if (p.to === "CLIENT_REVIEW" || (p.to === "APPROVED" && p.actor.type === "STAFF")) {
      const issues = captionIssues(item);
      if (issues.length) throw new ContentError(issues[0].message);
    }
    // The client's project manager approves before the client sees it. Without one, someone other than the author must complete the internal review.
    if (item.status === "INTERNAL_REVIEW" && p.to === "CLIENT_REVIEW") {
      const pm = item.clientId ? (await tx.client.findFirst({ where: { id: item.clientId }, select: { projectManagerId: true } }))?.projectManagerId ?? null : null;
      if (pm) {
        if (p.actor.id !== pm) throw new ContentError("Only this client's project manager approves content before it goes to the client.");
      } else if (item.createdById === p.actor.id) {
        throw new ContentError("Someone other than the author must complete the internal review.");
      }
    }
    const updated = await tx.contentItem.update({ where: { id: item.id }, data: { status: p.to } });
    await tx.contentEvent.create({ data: { itemId: item.id, actorId: p.actor.id, actorType: p.actor.type, fromStatus: item.status, toStatus: p.to, comment } });
    return { item: updated, from: item.status, comment };
  });

  // Notifications after the change is saved (idempotent per item and status)
  const { item, comment } = result;
  if (p.to === "PUBLISHED") await countPublishedAgainstQuota(db, item, p.actor.id);
  if (p.quiet) return item;
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
    select: { id: true, platform: true, platforms: true, postType: true, title: true, copy: true, hashtags: true, platformCopy: true, firstComment: true, plannedDate: true, plannedTime: true, status: true, version: true },
  });
}

// Moving several posts at once (the week view, the sheet, the client's "approve all"). Each post goes through the same rules
// as a single move; the ones that cannot move are reported, the rest move. One notification per person instead of one per post.
export async function bulkTransition(db: PrismaClient, p: { organizationId: string; ids: string[]; actor: ContentActor; to: string; comment?: string }) {
  const ids = [...new Set(p.ids)].slice(0, 200);
  if (ids.length === 0) throw new ContentError("Choose at least one post.");
  const moved: { id: string; title: string; clientId: string | null; createdById: string; assignedToId: string | null }[] = [];
  const failed: { id: string; title: string; reason: string }[] = [];
  for (const id of ids) {
    try {
      const it = await transition(db, { organizationId: p.organizationId, id, actor: p.actor, to: p.to, comment: p.comment, quiet: true });
      moved.push(it);
    } catch (e) {
      if (!(e instanceof ContentError)) throw e;
      const t = await db.contentItem.findFirst({ where: { id, organizationId: p.organizationId, ...(p.actor.type === "CLIENT" ? { clientId: p.actor.clientId ?? "-" } : {}) }, select: { title: true } });
      failed.push({ id, title: t?.title ?? "Unknown post", reason: e.message });
    }
  }
  const stamp = Date.now();
  if (p.to === "CLIENT_REVIEW") {
    const byClient = new Map<string, number>();
    for (const m of moved) if (m.clientId) byClient.set(m.clientId, (byClient.get(m.clientId) ?? 0) + 1);
    for (const [clientId, n] of byClient) {
      const users = await db.user.findMany({ where: { clientId, active: true }, select: { id: true } });
      await notifyMany(db, users.map((u) => u.id), { kind: "content.review", title: `${n} post${n === 1 ? "" : "s"} waiting for your approval`, link: "/portal/content", dedupeKey: `content-bulk:${clientId}:${stamp}` });
    }
  }
  if (p.actor.type === "CLIENT" && moved.length) {
    const staff = [...new Set(moved.flatMap((m) => [m.createdById, m.assignedToId]).filter((x): x is string => Boolean(x)))];
    await notifyMany(db, staff, { kind: "content.decision", title: p.to === "APPROVED" ? `Client approved ${moved.length} post${moved.length === 1 ? "" : "s"}` : `Client requested changes on ${moved.length} post${moved.length === 1 ? "" : "s"}`, body: p.comment || undefined, link: "/content?view=sheet", dedupeKey: `content-bulk-decision:${moved[0].id}:${stamp}` });
  }
  return { moved: moved.length, failed };
}
