// A sales agent adds a prospect they found themselves (a referral, their own contact, any other source) when no list was assigned to them.
// It is the same kind of prospect as one found by a search: owned by the agent, logged with Log contact (Contacted, Not interested,
// Interested -> becomes a CRM lead), and kept apart from the CRM until then. The quick form asks for a name, a phone (country picker plus the
// number as people write it locally), an optional email, a source and a note. Before it is saved it is checked against
//   - the do-not-contact list (phone and email), always refused
//   - every existing prospect, whatever its status or owner, always refused
//   - the CRM leads, with the shared duplicate protection (decision 65): refused in BLOCK mode, confirmable in WARN, skipped when OFF
// Each refusal names the form field it belongs to, so the form can show it next to that field.
// Free of Next.js imports so it can be tested against the database.
import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { normalizeEmail } from "./contacts";
import { findClientMatch, findLeadDuplicates, getPolicy, isSuppressed, presentDuplicate } from "./lead-duplicates";
import { agentProfile, FIELD_SOURCE } from "./field-visits";
import { isCountry, normalizeE164, phoneProblem, phoneTail } from "./phone";
import { ProspectorError, type Actor } from "./prospector";
import { rescoreProspects } from "./prospect-scoring";

type Db = PrismaClient;
export const MANUAL_SOURCES = ["REFERRAL", "OWN_CONTACT", "OTHER"] as const;
export type ManualSource = (typeof MANUAL_SOURCES)[number];
export const MANUAL_SOURCE_LABEL: Record<string, string> = { REFERRAL: "Referral", OWN_CONTACT: "Own contact", OTHER: "Other", [FIELD_SOURCE]: "Field visit" };
const STATUS_WORD: Record<string, string> = { NEW: "new", REVIEWED: "reviewed", ASSIGNED: "assigned", CONTACTED: "contacted", NOT_INTERESTED: "closed as not interested", SENT_TO_CRM: "already a lead", DISMISSED: "dismissed" };

const clean = (v: unknown, max: number) => String(v ?? "").replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const cleanNote = (v: unknown, max: number) => String(v ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim().slice(0, max);

export type ManualInput = { name?: string; phone?: string; country?: string; email?: string; source?: string; note?: string; campaignId?: string; website?: string; mapsUrl?: string; confirm?: boolean };
export type AddResult = { id: string; name: string };

function websiteFrom(raw: string): string | null {
  const t = clean(raw, 300);
  if (!t) return null;
  let u: URL;
  try { u = new URL(/^https?:\/\//i.test(t) ? t : `https://${t}`); } catch { return null; }
  return (u.protocol === "https:" || u.protocol === "http:") && u.hostname.includes(".") ? u.toString().replace(/\/$/, "") : null;
}
export { websiteFrom };

// A Google Maps link: a web address on a Google or goo.gl host (maps.app.goo.gl, google.com/maps, goo.gl/maps)
export function mapsLinkFrom(raw: string): string | null {
  const t = clean(raw, 500);
  if (!t) return null;
  let u: URL;
  try { u = new URL(/^https?:\/\//i.test(t) ? t : `https://${t}`); } catch { return null; }
  const h = u.hostname.toLowerCase();
  const ok = h === "goo.gl" || h.endsWith(".goo.gl") || /(^|\.)google\.[a-z.]+$/.test(h);
  return (u.protocol === "https:" || u.protocol === "http:") && ok ? u.toString() : null;
}

export async function addProspect(db: Db, actor: Actor, input: ManualInput, now = new Date()): Promise<AddResult> {
  if (!actor.permissions.has("crm.edit")) throw new ProspectorError("You do not have permission to add prospects.");
  const org = actor.organizationId;
  const name = clean(input.name, 160);
  if (!name) throw new ProspectorError("Enter the business or person's name.", "name");
  const source = (MANUAL_SOURCES as readonly string[]).includes(String(input.source)) ? (input.source as ManualSource) : null;
  if (!source) throw new ProspectorError("Choose where this prospect came from.", "source");
  const policy = await getPolicy(db, org);
  const picked = clean(input.country, 2).toUpperCase();
  const country = isCountry(picked) ? picked : policy.defaultCountry;
  const rawPhone = clean(input.phone, 40);
  const phone = rawPhone ? normalizeE164(rawPhone, country) : null;
  if (rawPhone && !phone) throw new ProspectorError(phoneProblem(rawPhone, country) ?? "That phone number does not look right.", "phone");
  const rawEmail = clean(input.email, 200);
  const email = rawEmail ? normalizeEmail(rawEmail) : null;
  if (rawEmail && !email) throw new ProspectorError("That email address does not look right. Use the form name@company.com.", "email");
  if (!phone && !email) throw new ProspectorError("Enter a phone number, or an email if you have no number, so the prospect can be checked against existing ones and contacted.", "phone");
  const rawSite = clean(input.website, 300);
  const website = rawSite ? websiteFrom(rawSite) : null;
  if (rawSite && !website) throw new ProspectorError("That website address does not look right. Use the form www.company.com.", "website");
  const rawMaps = clean(input.mapsUrl, 500);
  const mapsUrl = rawMaps ? mapsLinkFrom(rawMaps) : null;
  if (rawMaps && !mapsUrl) throw new ProspectorError("That does not look like a Google Maps link. Open the place in Google Maps, press Share, then Copy link.", "mapsUrl");
  const campaignRaw = clean(input.campaignId, 40);
  let campaignId: string | null = null;
  if (campaignRaw) {
    const c = await db.campaign.findFirst({ where: { id: campaignRaw, organizationId: org, archivedAt: null, status: { in: ["ACTIVE", "PLANNED"] } }, select: { id: true } });
    if (!c) throw new ProspectorError("That campaign is not available. Choose another one, or leave it empty.", "campaignId");
    campaignId = c.id;
  }
  const tail = phoneTail(phone);
  // The prospect belongs to the product the agent works (decision 71); an agent on no product adds a prospect with none, as before
  const productId = (await agentProfile(db, org, actor.id)).productId;

  // Two agents adding the same person at the same moment: the second waits for the first, then finds it
  const created = await db.$transaction(async (tx) => {
    for (const k of [phone && `P:${phone}`, email && `E:${email}`].filter(Boolean).sort() as string[]) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`prospect-key:${org}:${k}`}, 0))`;
    }

    if (await isSuppressed(tx as unknown as Db, org, { phone, email })) {
      throw new ProspectorError("This phone number or email is on the do-not-contact list, so it cannot be added.", phone ? "phone" : "email");
    }

    // A business that already buys from us is never a prospect again, for any product
    const client = await findClientMatch(tx as unknown as Db, org, { phone, email });
    if (client) throw new ProspectorError(`${client.name}${client.code ? ` (${client.code})` : ""} is already a client of ours, so it cannot be added as a prospect.`, phone ? "phone" : "email");

    const ors: Prisma.ProspectWhereInput[] = [];
    if (email) ors.push({ email: { equals: email, mode: "insensitive" } });
    if (tail) ors.push({ phone: { endsWith: tail } });
    // One business, one prospect per product: the same number held by a prospect of another product is allowed (decision 71)
    const same = await tx.prospect.findFirst({ where: { organizationId: org, productId: productId ?? null, OR: ors }, orderBy: { createdAt: "asc" }, select: { id: true, name: true, status: true, assignedToId: true, addedById: true, email: true, origin: true, createdAt: true, product: { select: { name: true } } } });
    // The person deleted this very prospect earlier (a wrong note, a typo) and is adding it again: bring that record back instead of refusing
    const revive = same && same.status === "DISMISSED" && same.origin === "MANUAL" && same.addedById === actor.id ? same.id : null;
    if (same && !revive) {
      const mine = actor.permissions.has("crm.view_all") || same.assignedToId === actor.id || same.addedById === actor.id;
      const field = email && same.email?.toLowerCase() === email ? "email" : "phone";
      if (same.status === "DISMISSED") throw new ProspectorError(`${mine ? same.name : "A prospect"} with this ${field === "email" ? "email" : "phone number"} was dismissed. Ask a sales manager to restore it.`, field);
      const when = same.createdAt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
      throw new ProspectorError(mine
        ? `${same.name} is already in Prospector (${STATUS_WORD[same.status] ?? same.status.toLowerCase()}) with this ${field === "email" ? "email" : "phone number"}. Open it from the list instead of adding it again.`
        : `${same.name} is already a prospect${same.product ? ` for ${same.product.name}` : ""} (added ${when}) with this ${field === "email" ? "email" : "phone number"} and belongs to another team member. Ask a sales manager if it should be reassigned.`, field);
    }

    if (policy.mode !== "OFF") {
      const dup = (await findLeadDuplicates(tx as unknown as Db, { organizationId: org, phone, email, country }, policy))[0];
      if (dup && (policy.mode === "BLOCK" || !input.confirm)) {
        const text = presentDuplicate(dup, { id: actor.id, permissions: actor.permissions }).text;
        throw new ProspectorError(policy.mode === "WARN" ? `${text} If this is a different person, tick "Add anyway" and save again.` : text, dup.matchedOn[0] === "email" ? "email" : "phone");
      }
    }

    if (revive) {
      return tx.prospect.update({
        where: { id: revive },
        data: { name, phone, email, country, website, mapsUrl, campaignId, sourceLabel: source, notes: cleanNote(input.note, 1000) || null, status: "ASSIGNED", assignedToId: actor.id, assignedAt: now },
        select: { id: true, name: true },
      });
    }
    return tx.prospect.create({
      data: {
        organizationId: org, searchId: null, placeId: `manual:${randomUUID()}`, origin: "MANUAL", productId, captureKind: "OFFICE", name, phone, email, country, website, mapsUrl, campaignId, sourceLabel: source, notes: cleanNote(input.note, 1000) || null,
        addedById: actor.id, status: "ASSIGNED", assignedToId: actor.id, assignedAt: now, placeFetchedAt: now,
      },
      select: { id: true, name: true },
    });
  });
  await rescoreProspects(db, org, [created.id], now);
  return created;
}

// An agent takes back a prospect they added by mistake (a wrong number, a duplicate they found later). It is dismissed, not deleted, so it stays
// on record and a manager can restore it; it can only be done before anyone has contacted it, and only by the person who added it or a manager.
export async function removeOwnProspect(db: Db, actor: Actor, prospectId: string): Promise<{ name: string }> {
  const row = await db.prospect.findFirst({ where: { id: prospectId, organizationId: actor.organizationId }, select: { id: true, name: true, origin: true, addedById: true, status: true, assignedToId: true } });
  const manager = actor.permissions.has("crm.view_all") && actor.permissions.has("crm.edit");
  if (!row || row.origin !== "MANUAL" || (!manager && row.addedById !== actor.id)) throw new ProspectorError("Only the person who added this prospect, or a sales manager, can remove it.");
  if (!["NEW", "REVIEWED", "ASSIGNED"].includes(row.status)) throw new ProspectorError("This prospect has already been contacted or closed, so it cannot be removed. Log the outcome instead.");
  if (!manager && row.assignedToId !== actor.id) throw new ProspectorError("This prospect was reassigned to someone else, so only a manager can remove it.");
  if (await db.prospectOutreach.count({ where: { prospectId } })) throw new ProspectorError("This prospect already has a contact logged, so it cannot be removed.");
  const done = await db.prospect.updateMany({ where: { id: prospectId, status: { in: ["NEW", "REVIEWED", "ASSIGNED"] } }, data: { status: "DISMISSED" } });
  if (done.count !== 1) throw new ProspectorError("This prospect was just changed by someone else. Refresh and try again.");
  return { name: row.name };
}
