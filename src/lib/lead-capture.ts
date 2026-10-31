// Lead capture from your websites. A LeadSource is one form or integration with its own secret key; a visitor's submission becomes a
// lead tagged with the source and campaign, assigned by round robin (or to a fixed person), de-duplicated against open leads, and
// announced to the assignee. The key only identifies the form: it is public in page source by nature, so everything is validated,
// rate limited and capped here. Only the hash of the key is stored. Free of Next.js imports so it can be tested.
import crypto from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { normalizeEmail, normalizePhone } from "./contacts";
import { ensureContactForLead } from "./crm-contacts";
import { leadAssigned } from "./events";
import { notifyMany, usersWithPermission } from "./notifications";

export class CaptureError extends Error { constructor(message: string, readonly status = 400) { super(message); } }
type Db = PrismaClient;

export const ASSIGN_MODES = ["NONE", "FIXED", "ROUND_ROBIN"] as const;
const hash = (k: string) => crypto.createHash("sha256").update(k).digest("hex");
export const newKey = () => `hlk_${crypto.randomBytes(24).toString("base64url")}`;

export function parseOrigins(raw: string | null | undefined): string[] {
  return (raw ?? "").split(/[\s,]+/).map((o) => o.trim().replace(/\/$/, "").toLowerCase()).filter(Boolean);
}
// "any website" when none are listed; otherwise the request's Origin must be one of them
export const originAllowed = (allowed: string[], origin: string | null) => allowed.length === 0 || (origin !== null && allowed.includes(origin.replace(/\/$/, "").toLowerCase()));

export async function createSource(db: Db, p: { organizationId: string; name: string; campaignId?: string | null; assignMode?: string; assigneeIds?: string[]; allowedOrigins?: string }) {
  const name = p.name.trim().slice(0, 80);
  if (name.length < 2) throw new CaptureError("Give the form a name, for example Classwell website.");
  const mode = p.assignMode ?? "ROUND_ROBIN";
  if (!(ASSIGN_MODES as readonly string[]).includes(mode)) throw new CaptureError("Choose how leads are assigned.");
  const ids = [...new Set(p.assigneeIds ?? [])];
  if (mode !== "NONE") {
    if (ids.length === 0) throw new CaptureError("Choose who receives these leads.");
    if ((await db.user.count({ where: { id: { in: ids }, organizationId: p.organizationId, userType: "EMPLOYEE", active: true } })) !== ids.length) throw new CaptureError("Choose active staff members.");
  }
  if (p.campaignId && !(await db.campaign.findFirst({ where: { id: p.campaignId, organizationId: p.organizationId, archivedAt: null } }))) throw new CaptureError("Unknown campaign.");
  const origins = parseOrigins(p.allowedOrigins);
  for (const o of origins) if (!/^https?:\/\/[a-z0-9.-]+(:\d+)?$/.test(o)) throw new CaptureError(`"${o}" is not a website address like https://example.com.`);
  const key = newKey();
  try {
    const source = await db.leadSource.create({ data: { organizationId: p.organizationId, name, keyHash: hash(key), campaignId: p.campaignId || null, assignMode: mode, assigneeIds: ids, allowedOrigins: origins.join(",") || null } });
    return { source, key };
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") throw new CaptureError("A form with that name already exists.");
    throw e;
  }
}

export async function rotateKey(db: Db, p: { organizationId: string; id: string }) {
  const key = newKey();
  const r = await db.leadSource.updateMany({ where: { id: p.id, organizationId: p.organizationId }, data: { keyHash: hash(key) } });
  if (r.count === 0) throw new CaptureError("Form not found.", 404);
  return key;
}

const cut = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim().slice(0, max) : "");

export type CaptureInput = Record<string, unknown>;
export type CaptureResult = { ok: true; duplicate: boolean };

export async function captureLead(db: Db, p: { key: string; input: CaptureInput; origin: string | null; now?: Date }): Promise<CaptureResult> {
  if (!/^hlk_[A-Za-z0-9_-]{20,64}$/.test(p.key)) throw new CaptureError("Unknown form.", 401);
  const source = await db.leadSource.findUnique({ where: { keyHash: hash(p.key) } });
  if (!source || !source.active) throw new CaptureError("Unknown form.", 401);
  if (!originAllowed(parseOrigins(source.allowedOrigins), p.origin)) throw new CaptureError("This website is not allowed to send leads with this key.", 403);
  const i = p.input;
  // A hidden field real visitors never fill: bots that do get a normal-looking answer and nothing is stored
  if (cut(i.website_url ?? i.company_website, 200)) return { ok: true, duplicate: false };
  const name = cut(i.name ?? i.full_name, 120) || cut(i.first_name, 60) + (cut(i.last_name, 60) ? ` ${cut(i.last_name, 60)}` : "");
  const emailRaw = cut(i.email, 200);
  const email = emailRaw ? normalizeEmail(emailRaw) : null;
  if (emailRaw && !email) throw new CaptureError("Enter a valid email address.");
  const phoneRaw = cut(i.phone, 40);
  const phone = phoneRaw ? normalizePhone(phoneRaw) : null;
  if (phoneRaw && !phone) throw new CaptureError("Enter a valid phone number.");
  if (!email && !phone) throw new CaptureError("Give an email address or a phone number so we can reply.");
  const leadName = name.trim() || (email ?? phone)!;
  if (leadName.length < 2) throw new CaptureError("Enter your name.");
  const company = cut(i.company, 160) || null;
  const message = cut(i.message ?? i.notes, 2000) || null;
  const landing = cut(i.landing_url ?? i.page_url, 500);
  let landingUrl: string | null = null;
  try { const u = new URL(landing); if (u.protocol === "https:" || u.protocol === "http:") landingUrl = u.toString().slice(0, 500); } catch { /* not a link: ignored */ }
  const utm = { utmSource: cut(i.utm_source, 80) || null, utmMedium: cut(i.utm_medium, 80) || null, utmCampaign: cut(i.utm_campaign, 120) || null };
  const org = source.organizationId;
  const now = p.now ?? new Date();

  // The same person submitting again is added as a note to their open lead, not a second lead
  const or = [email ? { email } : null, phone ? { phone } : null].filter(Boolean) as { email?: string; phone?: string }[];
  const existing = await db.lead.findFirst({ where: { organizationId: org, convertedAt: null, OR: or, stage: { isLost: false } }, orderBy: { createdAt: "desc" } });
  if (existing) {
    await db.leadActivity.create({ data: { leadId: existing.id, kind: "NOTE", body: `Submitted the ${source.name} form again${message ? `: ${message}` : ""}` } });
    await db.lead.update({ where: { id: existing.id }, data: { updatedAt: now } });
    if (existing.assignedToId) await notifyMany(db, [existing.assignedToId], { kind: "lead.resubmitted", title: `${existing.name} contacted you again`, body: source.name, link: `/leads/${existing.id}`, dedupeKey: `lead-again:${existing.id}:${now.toISOString().slice(0, 13)}` });
    return { ok: true, duplicate: true };
  }

  const stage = await db.pipelineStage.findFirst({ where: { organizationId: org, isWon: false, isLost: false }, orderBy: { sortOrder: "asc" } });
  if (!stage) throw new CaptureError("Not available right now.", 503);
  // Pick the next person in turn. The row lock makes two simultaneous submissions take different turns.
  const assignee = await db.$transaction(async (tx) => {
    if (source.assignMode === "NONE" || source.assigneeIds.length === 0) return null;
    await tx.$queryRaw`SELECT id FROM "LeadSource" WHERE id = ${source.id} FOR UPDATE`;
    const fresh = await tx.leadSource.findUniqueOrThrow({ where: { id: source.id } });
    const live = (await tx.user.findMany({ where: { id: { in: fresh.assigneeIds }, active: true, userType: "EMPLOYEE" }, select: { id: true } })).map((u) => u.id);
    const pool = fresh.assigneeIds.filter((id) => live.includes(id));
    if (pool.length === 0) return null;
    const pick = fresh.assignMode === "FIXED" ? pool[0] : pool[fresh.rrIndex % pool.length];
    if (fresh.assignMode === "ROUND_ROBIN") await tx.leadSource.update({ where: { id: source.id }, data: { rrIndex: fresh.rrIndex + 1 } });
    return pick;
  });
  const lead = await db.lead.create({
    data: {
      organizationId: org, name: leadName, company, email, phone, source: `Website: ${source.name}`, stageId: stage.id, assignedToId: assignee, campaignId: source.campaignId,
      leadSourceId: source.id, notes: message, landingUrl, ...utm, tags: ["website"], activities: { create: { kind: "CREATED", body: `Captured from the ${source.name} form${message ? `: ${message}` : ""}` } },
    },
  });
  await ensureContactForLead(db, lead.id);
  await db.leadSource.update({ where: { id: source.id }, data: { leadCount: { increment: 1 }, lastLeadAt: now } });
  if (assignee) await leadAssigned(db, { organizationId: org, leadId: lead.id, toUserId: assignee, byUserId: "website" });
  else await notifyMany(db, await usersWithPermission(db, org, "crm.view_all"), { kind: "lead.unassigned", title: `New unassigned lead: ${lead.name}`, body: source.name, link: `/leads/${lead.id}`, dedupeKey: `lead-new:${lead.id}` });
  return { ok: true, duplicate: false };
}
