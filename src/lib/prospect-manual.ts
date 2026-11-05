// A sales agent adds a prospect they found themselves (a referral, their own contact, any other source) when no list was assigned to them.
// It is the same kind of prospect as one found by a search: owned by the agent, logged with Log contact (Contacted, Not interested,
// Interested -> becomes a CRM lead), and kept apart from the CRM until then. Before it is saved it is checked against
//   - the do-not-contact list (phone and email), always refused
//   - every existing prospect, whatever its status or owner, always refused
//   - the CRM leads, with the shared duplicate protection (decision 65): refused in BLOCK mode, confirmable in WARN, skipped when OFF
// Free of Next.js imports so it can be tested against the database.
import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { normalizeEmail } from "./contacts";
import { findLeadDuplicates, getPolicy, presentDuplicate } from "./lead-duplicates";
import { isCountry, normalizeE164, phoneTail } from "./phone";
import { ProspectorError, type Actor } from "./prospector";
import { rescoreProspects } from "./prospect-scoring";

type Db = PrismaClient;
export const MANUAL_SOURCES = ["REFERRAL", "OWN_CONTACT", "OTHER"] as const;
export type ManualSource = (typeof MANUAL_SOURCES)[number];
export const MANUAL_SOURCE_LABEL: Record<string, string> = { REFERRAL: "Referral", OWN_CONTACT: "Own contact", OTHER: "Other" };
const STATUS_WORD: Record<string, string> = { NEW: "new", REVIEWED: "reviewed", ASSIGNED: "assigned", CONTACTED: "contacted", NOT_INTERESTED: "closed as not interested", SENT_TO_CRM: "already a lead", DISMISSED: "dismissed" };

const clean = (v: unknown, max: number) => String(v ?? "").replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const cleanNote = (v: unknown, max: number) => String(v ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim().slice(0, max);

export type ManualInput = { contactName?: string; company?: string; phone?: string; email?: string; website?: string; country?: string; city?: string; source?: string; sourceDetail?: string; notes?: string; confirm?: boolean };
export type AddResult = { id: string; name: string };

function websiteFrom(raw: string): string | null {
  const t = clean(raw, 300);
  if (!t) return null;
  let u: URL;
  try { u = new URL(/^https?:\/\//i.test(t) ? t : `https://${t}`); } catch { throw new ProspectorError("The website does not look like an address. Use something like example.com."); }
  if ((u.protocol !== "https:" && u.protocol !== "http:") || !u.hostname.includes(".")) throw new ProspectorError("The website does not look like an address. Use something like example.com.");
  return u.toString().replace(/\/$/, "");
}

export async function addProspect(db: Db, actor: Actor, input: ManualInput, now = new Date()): Promise<AddResult> {
  if (!actor.permissions.has("crm.edit")) throw new ProspectorError("You do not have permission to add prospects.");
  const org = actor.organizationId;
  const contactName = clean(input.contactName, 120);
  const company = clean(input.company, 160);
  if (!contactName && !company) throw new ProspectorError("Enter the contact's name or the company name.");
  const source = (MANUAL_SOURCES as readonly string[]).includes(String(input.source)) ? (input.source as ManualSource) : null;
  if (!source) throw new ProspectorError("Choose where this prospect came from: referral, own contact or other.");
  const sourceDetail = clean(input.sourceDetail, 200) || null;
  const policy = await getPolicy(db, org);
  const country = isCountry(clean(input.country, 2).toUpperCase()) ? clean(input.country, 2).toUpperCase() : policy.defaultCountry;
  const rawPhone = clean(input.phone, 40);
  const phone = rawPhone ? normalizeE164(rawPhone, country) : null;
  if (rawPhone && !phone) throw new ProspectorError("That phone number does not look right. Include the area or mobile code, for example 0300 1234567.");
  const rawEmail = clean(input.email, 200);
  const email = rawEmail ? normalizeEmail(rawEmail) : null;
  if (rawEmail && !email) throw new ProspectorError("That email address does not look right.");
  if (!phone && !email) throw new ProspectorError("Enter a phone number or an email, so the prospect can be checked against existing ones and contacted.");
  const website = websiteFrom(String(input.website ?? ""));
  const name = company || contactName;
  const tail = phoneTail(phone);

  // Two agents adding the same person at the same moment: the second waits for the first, then finds it
  const created = await db.$transaction(async (tx) => {
    for (const k of [phone && `P:${phone}`, email && `E:${email}`].filter(Boolean).sort() as string[]) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`prospect-key:${org}:${k}`}, 0))`;
    }

    const blocked = await tx.suppressedContact.findMany({ where: { organizationId: org, OR: [...(email ? [{ email: { equals: email, mode: "insensitive" as const } }] : []), ...(tail ? [{ phone: { not: null } }] : [])] }, select: { phone: true, email: true } });
    if (blocked.some((b) => (email && b.email?.toLowerCase() === email) || (tail && phoneTail(b.phone) === tail))) {
      throw new ProspectorError("This phone number or email is on the do-not-contact list, so it cannot be added.");
    }

    const ors: Prisma.ProspectWhereInput[] = [];
    if (email) ors.push({ email: { equals: email, mode: "insensitive" } });
    if (tail) ors.push({ phone: { endsWith: tail } });
    const same = await tx.prospect.findFirst({ where: { organizationId: org, OR: ors }, orderBy: { createdAt: "asc" }, select: { id: true, name: true, status: true, assignedToId: true, addedById: true } });
    if (same) {
      const mine = actor.permissions.has("crm.view_all") || same.assignedToId === actor.id || same.addedById === actor.id;
      throw new ProspectorError(mine
        ? `${same.name} is already in Prospector (${STATUS_WORD[same.status] ?? same.status.toLowerCase()}) with this phone number or email. Open it from the list instead of adding it again.`
        : "This phone number or email is already in Prospector and belongs to another team member. Ask a sales manager if it should be reassigned.");
    }

    if (policy.mode !== "OFF") {
      const dup = (await findLeadDuplicates(tx as unknown as Db, { organizationId: org, phone, email, country }, policy))[0];
      if (dup && (policy.mode === "BLOCK" || !input.confirm)) {
        const text = presentDuplicate(dup, { id: actor.id, permissions: actor.permissions }).text;
        throw new ProspectorError(policy.mode === "WARN" ? `${text} Tick "Add anyway" if this is a different person.` : text);
      }
    }

    return tx.prospect.create({
      data: {
        organizationId: org, searchId: null, placeId: `manual:${randomUUID()}`, origin: "MANUAL", name, contactName: contactName || null, phone, email, website, country,
        city: clean(input.city, 80) || null, sourceLabel: source, sourceDetail, notes: cleanNote(input.notes, 1000) || null, addedById: actor.id,
        status: "ASSIGNED", assignedToId: actor.id, assignedAt: now, placeFetchedAt: now,
      },
      select: { id: true, name: true },
    });
  });
  await rescoreProspects(db, org, [created.id], now);
  return created;
}
