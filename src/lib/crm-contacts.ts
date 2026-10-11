// Contacts and organizations: the single record that leads, clients, activities and meetings all point to.
// Sync rules (tested):
//  - A lead always has a contact. Creating a lead creates or links one (matched by email or phone), so the Contacts screen never misses a lead.
//  - Editing a contact updates the name, email, phone and place on its leads and the email and phone on its client; editing a lead updates its contact.
//  - Converting a lead marks the contact (and its organization) as a Customer and links the client account.
//  - An activity logged on a contact also appears on its open lead (and counts toward sales targets), and one logged on the lead appears on the contact, each stored once.
//  - Duplicate emails and phones are detected across all of a contact's values, not just the first.
import type { Prisma, PrismaClient } from "@prisma/client";
import { dec } from "./ledger-math";
import { CURRENCIES } from "./money";

export class ContactError extends Error {
  constructor(message: string, public duplicates?: { id: string; name: string; email: string | null; phone: string | null }[]) { super(message); }
}
type Db = PrismaClient;
type Tx = Prisma.TransactionClient;

export const CATEGORIES = ["LEAD", "CUSTOMER", "PARTNER", "VENDOR", "INVESTOR", "OTHER"] as const;
export const PHONE_TYPES = ["WORK", "MOBILE", "HOME", "WHATSAPP", "OTHER"] as const;
export const EMAIL_TYPES = ["WORK", "PERSONAL", "BILLING", "OTHER"] as const;
export const CONTACT_KINDS = ["PERSON", "ORGANIZATION"] as const;
const ACTIVITY_KINDS = ["NOTE", "CALL", "EMAIL", "MEETING", "WHATSAPP"] as const;
const CALL_OUTCOMES = ["NO_ANSWER", "VOICEMAIL", "CONNECTED", "WRONG_NUMBER", "NOT_INTERESTED"] as const;

export type Entry = { type: string; value: string };
export type ContactInput = {
  kind?: string; title?: string | null; firstName?: string | null; lastName?: string | null; name?: string | null; parentId?: string | null; parentName?: string | null;
  category?: string; industry?: string | null; jobTitle?: string | null; ownerId?: string | null; followers?: string[]; website?: string | null;
  phones?: Entry[]; emails?: Entry[]; addressLine?: string | null; city?: string | null; state?: string | null; country?: string | null; postalCode?: string | null;
  timezone?: string | null; preferredContact?: string | null; source?: string | null; campaignId?: string | null; tags?: string[]; notes?: string | null; customFields?: Record<string, string>;
};

// ---------- cleaning ----------
export const phoneKey = (p: string) => { const d = p.replace(/[^\d+]/g, ""); return d.length >= 6 ? d.replace(/^00/, "+") : null; };
const emailOk = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) && e.length <= 254;
const txt = (v: string | null | undefined, max: number) => { const t = (v ?? "").trim().slice(0, max); return t || null; };

function cleanEntries(list: Entry[] | undefined, kind: "phone" | "email"): Entry[] {
  const types: readonly string[] = kind === "phone" ? PHONE_TYPES : EMAIL_TYPES;
  const out: Entry[] = [];
  const seen = new Set<string>();
  for (const e of (list ?? []).slice(0, 10)) {
    const raw = (e.value ?? "").trim();
    if (!raw) continue;
    const type = types.includes(e.type) ? e.type : "WORK";
    if (kind === "email") {
      const v = raw.toLowerCase();
      if (!emailOk(v)) throw new ContactError(`"${raw}" is not a valid email address.`);
      if (!seen.has(v)) { seen.add(v); out.push({ type, value: v }); }
    } else {
      const k = phoneKey(raw);
      if (!k) throw new ContactError(`"${raw}" is not a valid phone number (include the country code, for example +92 316 8080801).`);
      if (!seen.has(k)) { seen.add(k); out.push({ type, value: raw.slice(0, 30) }); }
    }
  }
  return out;
}

const cleanTags = (t?: string[]) => [...new Set((t ?? []).map((x) => x.trim().toLowerCase().slice(0, 30)).filter(Boolean))].slice(0, 12);
const displayName = (kind: string, f: string | null, l: string | null, name: string | null) => (kind === "ORGANIZATION" ? (name ?? "").trim() : [f, l].filter(Boolean).join(" ").trim());

function derived(phones: Entry[], emails: Entry[]) {
  return { primaryPhone: phones[0] ? phoneKey(phones[0].value) : null, primaryEmail: emails[0]?.value ?? null, matchKeys: [...emails.map((e) => e.value), ...phones.map((p) => phoneKey(p.value)!).filter(Boolean)] };
}

// ---------- scope ----------
export type Who = { id: string; organizationId: string; permissions: ReadonlySet<string> };
// Managers see every contact; everyone else sees contacts they own, follow or created.
export const contactScope = (w: Who): Prisma.ContactWhereInput =>
  w.permissions.has("crm.view_all") ? { organizationId: w.organizationId } : { organizationId: w.organizationId, OR: [{ ownerId: w.id }, { createdById: w.id }, { followers: { has: w.id } }] };

// ---------- duplicates ----------
export async function findDuplicates(db: Db | Tx, organizationId: string, p: { emails: string[]; phones: string[]; name?: string | null; kind?: string; excludeId?: string }) {
  const keys = [...p.emails, ...p.phones.map((x) => phoneKey(x)).filter(Boolean) as string[]];
  const or: Prisma.ContactWhereInput[] = [];
  if (keys.length) or.push({ matchKeys: { hasSome: keys } });
  if (p.kind === "ORGANIZATION" && p.name) or.push({ kind: "ORGANIZATION", name: { equals: p.name.trim(), mode: "insensitive" } });
  if (or.length === 0) return [];
  const rows = await db.contact.findMany({ where: { organizationId, archived: false, ...(p.excludeId ? { id: { not: p.excludeId } } : {}), OR: or }, take: 5, select: { id: true, name: true, primaryEmail: true, primaryPhone: true } });
  return rows.map((r) => ({ id: r.id, name: r.name, email: r.primaryEmail, phone: r.primaryPhone }));
}

// ---------- create ----------
async function resolveParent(tx: Tx, organizationId: string, actorId: string, i: ContactInput) {
  if (i.parentId) {
    const p = await tx.contact.findFirst({ where: { id: i.parentId, organizationId, kind: "ORGANIZATION" } });
    if (!p) throw new ContactError("Choose an organization from the list.");
    return p;
  }
  const n = txt(i.parentName, 160);
  if (!n) return null;
  const existing = await tx.contact.findFirst({ where: { organizationId, kind: "ORGANIZATION", archived: false, name: { equals: n, mode: "insensitive" } } });
  if (existing) return existing;
  return tx.contact.create({ data: { organizationId, kind: "ORGANIZATION", name: n, category: "LEAD", ownerId: i.ownerId ?? actorId, createdById: actorId, phones: [], emails: [], matchKeys: [] } });
}

function build(i: ContactInput, kind: string) {
  const phones = cleanEntries(i.phones, "phone");
  const emails = cleanEntries(i.emails, "email");
  const first = txt(i.firstName, 80), last = txt(i.lastName, 80);
  const name = displayName(kind, first, last, i.name ?? null);
  if (!name) throw new ContactError(kind === "ORGANIZATION" ? "Enter the organization's name." : "Enter at least a first or last name.");
  if (name.length > 160) throw new ContactError("The name is too long.");
  if (i.category && !(CATEGORIES as readonly string[]).includes(i.category)) throw new ContactError("Choose a category.");
  const website = txt(i.website, 200);
  if (website && /\s/.test(website)) throw new ContactError("The website cannot contain spaces.");
  if (i.timezone?.trim()) { try { new Intl.DateTimeFormat("en", { timeZone: i.timezone.trim() }); } catch { throw new ContactError("That time zone is not recognised (for example Asia/Karachi)."); } }
  const custom: Record<string, string> = {};
  for (const [k, v] of Object.entries(i.customFields ?? {}).slice(0, 20)) { const kk = k.trim().slice(0, 40), vv = String(v).trim().slice(0, 200); if (kk && vv) custom[kk] = vv; }
  return {
    kind, title: txt(i.title, 20), firstName: kind === "PERSON" ? first : null, lastName: kind === "PERSON" ? last : null, name, category: i.category ?? "LEAD", industry: txt(i.industry, 80), jobTitle: txt(i.jobTitle, 80),
    website, phones: phones as unknown as Prisma.InputJsonValue, emails: emails as unknown as Prisma.InputJsonValue, ...derived(phones, emails), addressLine: txt(i.addressLine, 200), city: txt(i.city, 80), state: txt(i.state, 80),
    country: txt(i.country, 80), postalCode: txt(i.postalCode, 20), timezone: txt(i.timezone, 60), preferredContact: i.preferredContact && ["CALL", "WHATSAPP", "EMAIL", "SMS"].includes(i.preferredContact) ? i.preferredContact : null,
    source: txt(i.source, 80), campaignId: txt(i.campaignId, 40), tags: cleanTags(i.tags), notes: txt(i.notes, 4000), customFields: custom as Prisma.InputJsonValue,
  };
}

export type OpportunityInput = { dealValue?: string | null; currency?: string; serviceInterest?: string | null; stageId?: string | null; expectedCloseDate?: string | null };

export async function createContact(db: Db, p: { organizationId: string; actorId: string; input: ContactInput; opportunity?: OpportunityInput | null; confirmDuplicate?: boolean }) {
  const kind = p.input.kind ?? "PERSON";
  if (!(CONTACT_KINDS as readonly string[]).includes(kind)) throw new ContactError("Choose person or organization.");
  const data = build(p.input, kind);
  const ownerId = p.input.ownerId || p.actorId;
  if (!(await db.user.findFirst({ where: { id: ownerId, organizationId: p.organizationId, active: true, userType: "EMPLOYEE" } }))) throw new ContactError("Choose an active staff member as the assignee.");
  const followers = [...new Set((p.input.followers ?? []).filter((x) => x !== ownerId))].slice(0, 20);
  if (followers.length && (await db.user.count({ where: { id: { in: followers }, organizationId: p.organizationId, active: true, userType: "EMPLOYEE" } })) !== followers.length) throw new ContactError("A follower is not an active staff member.");
  if (p.opportunity?.dealValue && !/^\d{1,12}(\.\d{1,2})?$/.test(p.opportunity.dealValue)) throw new ContactError("Deal value must be a positive number.");
  if (p.opportunity?.currency && !(CURRENCIES as readonly string[]).includes(p.opportunity.currency)) throw new ContactError("Choose a supported currency.");
  const dups = await findDuplicates(db, p.organizationId, { emails: (data.emails as unknown as Entry[]).map((e) => e.value), phones: (data.phones as unknown as Entry[]).map((x) => x.value), name: data.name, kind });
  if (dups.length && !p.confirmDuplicate) throw new ContactError("This looks like someone who is already in the system.", dups);

  return db.$transaction(async (tx) => {
    const parent = kind === "PERSON" ? await resolveParent(tx, p.organizationId, p.actorId, p.input) : null;
    const c = await tx.contact.create({ data: { ...data, organizationId: p.organizationId, parentId: parent?.id ?? null, ownerId, followers, createdById: p.actorId, lastActivityAt: new Date() } });
    await tx.contactActivity.create({ data: { contactId: c.id, actorId: p.actorId, kind: "SYSTEM", body: "Contact created" } });
    if (p.opportunity) await openOpportunity(tx, { organizationId: p.organizationId, contact: c, parentName: parent?.name ?? null, actorId: p.actorId, ownerId, opp: p.opportunity });
    return c;
  });
}

async function openOpportunity(tx: Tx, p: { organizationId: string; contact: { id: string; name: string; kind: string; primaryEmail: string | null; primaryPhone: string | null; city: string | null; country: string | null; source: string | null; campaignId: string | null; tags: string[]; preferredContact: string | null; timezone: string | null }; parentName: string | null; actorId: string; ownerId: string; opp: OpportunityInput }) {
  const stage = p.opp.stageId
    ? await tx.pipelineStage.findFirst({ where: { id: p.opp.stageId, organizationId: p.organizationId } })
    : await tx.pipelineStage.findFirst({ where: { organizationId: p.organizationId }, orderBy: { sortOrder: "asc" } });
  if (!stage) throw new ContactError("The sales pipeline has no stages yet.");
  const lead = await tx.lead.create({
    data: {
      organizationId: p.organizationId, name: p.contact.name, company: p.contact.kind === "ORGANIZATION" ? p.contact.name : p.parentName, email: p.contact.primaryEmail, phone: p.contact.primaryPhone,
      city: p.contact.city, country: p.contact.country, source: p.contact.source, campaignId: p.contact.campaignId, tags: p.contact.tags, preferredContact: p.contact.preferredContact, timezone: p.contact.timezone,
      serviceInterest: txt(p.opp.serviceInterest, 120), dealValue: p.opp.dealValue || null, currency: p.opp.currency ?? "USD", expectedCloseDate: p.opp.expectedCloseDate || null,
      stageId: stage.id, assignedToId: p.ownerId, createdById: p.actorId, contactId: p.contact.id, activities: { create: { kind: "CREATED", actorId: p.actorId, body: "Opportunity opened from the contact record" } },
    },
  });
  await tx.contactActivity.create({ data: { contactId: p.contact.id, actorId: p.actorId, kind: "SYSTEM", body: `Opportunity L-${lead.number} opened in ${stage.name}` } });
  return lead;
}

export async function openOpportunityFor(db: Db, p: { organizationId: string; contactId: string; actorId: string; opp: OpportunityInput }) {
  const c = await db.contact.findFirst({ where: { id: p.contactId, organizationId: p.organizationId, archived: false } });
  if (!c) throw new ContactError("Contact not found.");
  if (p.opp.dealValue && !/^\d{1,12}(\.\d{1,2})?$/.test(p.opp.dealValue)) throw new ContactError("Deal value must be a positive number.");
  const parent = c.parentId ? await db.contact.findUnique({ where: { id: c.parentId }, select: { name: true } }) : null;
  return db.$transaction((tx) => openOpportunity(tx, { organizationId: p.organizationId, contact: c, parentName: parent?.name ?? null, actorId: p.actorId, ownerId: c.ownerId ?? p.actorId, opp: p.opp }));
}

// ---------- update and sync ----------
export async function updateContact(db: Db, p: { organizationId: string; id: string; actorId: string; patch: ContactInput }) {
  const cur = await db.contact.findFirst({ where: { id: p.id, organizationId: p.organizationId } });
  if (!cur) throw new ContactError("Contact not found.");
  const merged: ContactInput = {
    kind: cur.kind, title: cur.title, firstName: cur.firstName, lastName: cur.lastName, name: cur.kind === "ORGANIZATION" ? cur.name : null, category: cur.category, industry: cur.industry, jobTitle: cur.jobTitle,
    website: cur.website, phones: cur.phones as unknown as Entry[], emails: cur.emails as unknown as Entry[], addressLine: cur.addressLine, city: cur.city, state: cur.state, country: cur.country, postalCode: cur.postalCode,
    timezone: cur.timezone, preferredContact: cur.preferredContact, source: cur.source, campaignId: cur.campaignId, tags: cur.tags, notes: cur.notes, customFields: cur.customFields as Record<string, string>, ...p.patch,
  };
  const data = build(merged, cur.kind);
  const extra: Prisma.ContactUncheckedUpdateInput = {};
  if (p.patch.ownerId !== undefined) {
    if (p.patch.ownerId && !(await db.user.findFirst({ where: { id: p.patch.ownerId, organizationId: p.organizationId, active: true, userType: "EMPLOYEE" } }))) throw new ContactError("Choose an active staff member as the assignee.");
    extra.ownerId = p.patch.ownerId || null;
  }
  if (p.patch.followers) extra.followers = [...new Set(p.patch.followers)].slice(0, 20);
  const dups = await findDuplicates(db, p.organizationId, { emails: (data.emails as unknown as Entry[]).map((e) => e.value), phones: (data.phones as unknown as Entry[]).map((x) => x.value), excludeId: cur.id });
  if (dups.length && (p.patch.emails || p.patch.phones)) throw new ContactError("Another contact already has that email or phone number.", dups);
  return db.$transaction(async (tx) => {
    const { kind: _k, ...rest } = data; void _k;
    const c = await tx.contact.update({ where: { id: cur.id }, data: { ...rest, ...extra, lastActivityAt: new Date() } });
    await pushToBoards(tx, c);
    return c;
  });
}

type CRow = { id: string; kind: string; name: string; parentId: string | null; primaryEmail: string | null; primaryPhone: string | null; city: string | null; country: string | null; timezone: string | null; preferredContact: string | null; tags: string[]; organizationId: string };

// Contact → leads and client. Name, email, phone and place follow the contact; the client's own name and billing details are left alone.
async function pushToBoards(tx: Tx, c: CRow) {
  const company = c.kind === "ORGANIZATION" ? c.name : c.parentId ? (await tx.contact.findUnique({ where: { id: c.parentId }, select: { name: true } }))?.name ?? null : null;
  await tx.lead.updateMany({ where: { contactId: c.id }, data: { name: c.name, email: c.primaryEmail, phone: c.primaryPhone, city: c.city, country: c.country, timezone: c.timezone, preferredContact: c.preferredContact, tags: c.tags, ...(company !== null || c.kind === "PERSON" ? { company } : {}) } });
  await tx.client.updateMany({ where: { contactId: c.id }, data: { email: c.primaryEmail, phone: c.primaryPhone } });
  if (c.kind === "ORGANIZATION") {
    const kids = await tx.contact.findMany({ where: { parentId: c.id }, select: { id: true } });
    if (kids.length) await tx.lead.updateMany({ where: { contactId: { in: kids.map((k) => k.id) } }, data: { company: c.name } });
  }
}

// Lead → contact (after a lead is created or edited on the lead screens).
export async function ensureContactForLead(db: Db | Tx, leadId: string): Promise<string | null> {
  const lead = await db.lead.findUnique({ where: { id: leadId } });
  if (!lead) return null;
  const emails: Entry[] = lead.email ? [{ type: "WORK", value: lead.email.toLowerCase() }] : [];
  const phones: Entry[] = lead.phone && phoneKey(lead.phone) ? [{ type: "WORK", value: lead.phone }] : [];
  const company = lead.company?.trim() || null;
  if (lead.contactId) {
    const c = await db.contact.findUnique({ where: { id: lead.contactId } });
    if (c) {
      // keep the contact in step with what was just edited on the lead
      const d = derived(phones.length ? phones : (c.phones as unknown as Entry[]), emails.length ? emails : (c.emails as unknown as Entry[]));
      const parts = lead.name.trim().split(/\s+/);
      await db.contact.update({ where: { id: c.id }, data: { ...(c.kind === "PERSON" ? { name: lead.name.trim().slice(0, 160), firstName: parts[0] ?? null, lastName: parts.slice(1).join(" ") || null } : {}), emails: (emails.length ? emails : c.emails) as Prisma.InputJsonValue, phones: (phones.length ? phones : c.phones) as Prisma.InputJsonValue, ...d, city: lead.city ?? c.city, country: lead.country ?? c.country, source: lead.source ?? c.source, tags: lead.tags.length ? lead.tags : c.tags, campaignId: lead.campaignId ?? c.campaignId } });
      return c.id;
    }
  }
  const dups = await findDuplicates(db, lead.organizationId, { emails: emails.map((e) => e.value), phones: phones.map((x) => x.value) });
  let id = dups[0]?.id ?? null;
  if (!id) {
    let parentId: string | null = null;
    if (company) {
      const org = await db.contact.findFirst({ where: { organizationId: lead.organizationId, kind: "ORGANIZATION", archived: false, name: { equals: company, mode: "insensitive" } } })
        ?? (await db.contact.create({ data: { organizationId: lead.organizationId, kind: "ORGANIZATION", name: company.slice(0, 160), category: "LEAD", ownerId: lead.assignedToId, createdById: lead.createdById, phones: [], emails: [], matchKeys: [], country: lead.country } }));
      parentId = org.id;
    }
    const parts = lead.name.trim().split(/\s+/);
    const c = await db.contact.create({
      data: {
        organizationId: lead.organizationId, kind: "PERSON", firstName: parts[0] ?? null, lastName: parts.slice(1).join(" ") || null, name: lead.name.trim().slice(0, 160), parentId, category: lead.clientId ? "CUSTOMER" : "LEAD", ownerId: lead.assignedToId,
        createdById: lead.createdById, emails: emails as unknown as Prisma.InputJsonValue, phones: phones as unknown as Prisma.InputJsonValue, ...derived(phones, emails), city: lead.city, country: lead.country, timezone: lead.timezone, preferredContact: lead.preferredContact,
        source: lead.source, campaignId: lead.campaignId, tags: lead.tags, lastActivityAt: lead.lastContactAt ?? lead.createdAt,
      },
    });
    id = c.id;
    await db.contactActivity.create({ data: { contactId: id, actorId: lead.createdById, kind: "SYSTEM", body: `Created from lead L-${lead.number}` } });
  }
  await db.lead.update({ where: { id: lead.id }, data: { contactId: id } });
  return id;
}

// The conversion workflow calls this once the client exists.
export async function onLeadConverted(db: Db | Tx, p: { leadId: string; clientId: string; clientCode?: string | null }) {
  const contactId = await ensureContactForLead(db, p.leadId);
  if (!contactId) return;
  const c = await db.contact.findUnique({ where: { id: contactId } });
  if (!c) return;
  await db.client.update({ where: { id: p.clientId }, data: { contactId } });
  await db.contact.update({ where: { id: contactId }, data: { category: "CUSTOMER", lastActivityAt: new Date() } });
  if (c.parentId) await db.contact.update({ where: { id: c.parentId }, data: { category: "CUSTOMER" } });
  await db.contactActivity.create({ data: { contactId, kind: "SYSTEM", body: `Became a customer${p.clientCode ? ` (client ${p.clientCode})` : ""}` } });
}

// One-time catch-up for records that existed before contacts did. Safe to repeat.
export async function backfillContacts(db: Db, organizationId: string) {
  let leads = 0, clients = 0;
  for (const l of await db.lead.findMany({ where: { organizationId, contactId: null }, select: { id: true } })) { await ensureContactForLead(db, l.id); leads++; }
  for (const c of await db.client.findMany({ where: { organizationId, contactId: null } })) {
    const emails: Entry[] = c.email ? [{ type: "BILLING", value: c.email.toLowerCase() }] : [];
    const phones: Entry[] = c.phone && phoneKey(c.phone) ? [{ type: "WORK", value: c.phone }] : [];
    const dups = await findDuplicates(db, organizationId, { emails: emails.map((e) => e.value), phones: phones.map((x) => x.value), name: c.name, kind: "ORGANIZATION" });
    let id = dups.find(() => true)?.id;
    if (!id) id = (await db.contact.create({ data: { organizationId, kind: "ORGANIZATION", name: c.name.slice(0, 160), category: "CUSTOMER", emails: emails as unknown as Prisma.InputJsonValue, phones: phones as unknown as Prisma.InputJsonValue, ...derived(phones, emails), country: c.country, addressLine: c.billingAddress, customFields: c.taxId ? { "Tax ID": c.taxId } : {} } })).id;
    else await db.contact.update({ where: { id }, data: { category: "CUSTOMER" } });
    await db.client.update({ where: { id: c.id }, data: { contactId: id } });
    clients++;
  }
  return { leads, clients };
}

// ---------- activities (mirrored with the lead, once) ----------
export async function logContactActivity(db: Db, p: { organizationId: string; contactId: string; actorId: string; kind: string; outcome?: string; body?: string }) {
  if (!(ACTIVITY_KINDS as readonly string[]).includes(p.kind)) throw new ContactError("Choose what happened.");
  if (p.kind === "CALL" && !(CALL_OUTCOMES as readonly string[]).includes(p.outcome ?? "")) throw new ContactError("Say how the call went.");
  if (p.kind !== "CALL" && p.outcome) throw new ContactError("Only calls have an outcome.");
  if ((p.body ?? "").length > 2000) throw new ContactError("The note is too long.");
  const c = await db.contact.findFirst({ where: { id: p.contactId, organizationId: p.organizationId } });
  if (!c) throw new ContactError("Contact not found.");
  return db.$transaction(async (tx) => {
    const lead = await tx.lead.findFirst({ where: { contactId: c.id, clientId: null, stage: { isWon: false, isLost: false } }, orderBy: { createdAt: "desc" } });
    let leadActivityId: string | null = null;
    if (lead) {
      const la = await tx.leadActivity.create({ data: { leadId: lead.id, actorId: p.actorId, kind: p.kind, outcome: p.outcome ?? null, body: p.body?.trim() || null } });
      leadActivityId = la.id;
      const contacted = p.kind !== "NOTE" && !(p.kind === "CALL" && p.outcome !== "CONNECTED");
      if (contacted) await tx.lead.update({ where: { id: lead.id }, data: { lastContactAt: new Date() } });
    }
    const a = await tx.contactActivity.create({ data: { contactId: c.id, actorId: p.actorId, kind: p.kind, outcome: p.outcome ?? null, body: p.body?.trim() || null, leadActivityId } });
    await tx.contact.update({ where: { id: c.id }, data: { lastActivityAt: new Date() } });
    return a;
  });
}

// Called after an activity is logged on a lead screen so the contact timeline shows it too.
export async function mirrorLeadActivity(db: Db | Tx, leadActivityId: string) {
  const la = await db.leadActivity.findUnique({ where: { id: leadActivityId }, include: { lead: { select: { contactId: true } } } });
  if (!la?.lead.contactId || !["NOTE", "CALL", "EMAIL", "MEETING", "WHATSAPP", "FOLLOW_UP", "PROPOSAL", "APPOINTMENT"].includes(la.kind)) return;
  const kind = la.kind === "FOLLOW_UP" || la.kind === "PROPOSAL" ? "NOTE" : la.kind === "APPOINTMENT" ? "MEETING" : la.kind;
  await db.contactActivity.upsert({ where: { leadActivityId: la.id }, update: {}, create: { contactId: la.lead.contactId, actorId: la.actorId, kind, outcome: la.outcome, body: la.kind === "FOLLOW_UP" || la.kind === "PROPOSAL" ? `${la.kind === "FOLLOW_UP" ? "Follow-up" : "Proposal"}: ${la.body ?? ""}`.trim() : la.body, leadActivityId: la.id, createdAt: la.createdAt } });
  await db.contact.update({ where: { id: la.lead.contactId }, data: { lastActivityAt: la.createdAt } });
}

// ---------- listing, bulk actions, export ----------
export type ListQuery = { tab?: "all" | "organizations" | "contacts"; q?: string; category?: string; ownerId?: string; tag?: string; source?: string; archived?: boolean; sort?: string; dir?: "asc" | "desc"; page?: number; pageSize?: number };
const NULLABLE = new Set(["ownerId", "lastActivityAt"]);
const SORTS: Record<string, string> = { name: "name", category: "category", owner: "ownerId", created: "createdAt", activity: "lastActivityAt" };

export async function listContacts(db: Db, who: Who, q: ListQuery) {
  const esc = (s: string) => s.replace(/[\\%_]/g, (c) => "\\" + c);
  const and: Prisma.ContactWhereInput[] = [contactScope(who), { archived: Boolean(q.archived) }];
  if (q.tab === "organizations") and.push({ kind: "ORGANIZATION" });
  if (q.tab === "contacts") and.push({ kind: "PERSON" });
  if (q.category) and.push({ category: q.category });
  if (q.ownerId) and.push(q.ownerId === "none" ? { ownerId: null } : { ownerId: q.ownerId });
  if (q.tag) and.push({ tags: { has: q.tag.toLowerCase() } });
  if (q.source) and.push({ source: { equals: q.source, mode: "insensitive" } });
  if (q.q?.trim()) {
    const s = esc(q.q.trim().slice(0, 80));
    const digits = q.q.replace(/[^\d+]/g, "");
    and.push({ OR: [{ name: { contains: s, mode: "insensitive" } }, { primaryEmail: { contains: s, mode: "insensitive" } }, { jobTitle: { contains: s, mode: "insensitive" } }, { industry: { contains: s, mode: "insensitive" } }, ...(digits.length >= 3 ? [{ primaryPhone: { contains: digits } }] : []), { tags: { has: q.q.trim().toLowerCase() } }] });
  }
  const pageSize = Math.min(Math.max(q.pageSize ?? 25, 5), 100);
  const page = Math.max(q.page ?? 1, 1);
  const sortField = SORTS[q.sort ?? "name"] ?? "name";
  const where = { AND: and };
  const [rows, total, counts] = await Promise.all([
    db.contact.findMany({ where, orderBy: [NULLABLE.has(sortField) ? { [sortField]: { sort: q.dir === "desc" ? "desc" : "asc", nulls: "last" } } : { [sortField]: q.dir === "desc" ? "desc" : "asc" }, { id: "asc" }] as never, skip: (page - 1) * pageSize, take: pageSize, include: { _count: { select: { activities: true } } } }),
    db.contact.count({ where }),
    db.contact.groupBy({ by: ["kind"], where: { AND: [contactScope(who), { archived: Boolean(q.archived) }] }, _count: true }),
  ]);
  const parents = new Map((await db.contact.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.parentId).filter(Boolean) as string[])] } }, select: { id: true, name: true } })).map((p) => [p.id, p.name]));
  return { rows: rows.map((r) => ({ ...r, parentName: r.parentId ? parents.get(r.parentId) ?? null : null })), total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)), tabCounts: { organizations: counts.find((c) => c.kind === "ORGANIZATION")?._count ?? 0, contacts: counts.find((c) => c.kind === "PERSON")?._count ?? 0 } };
}

export type BulkAction = "ASSIGN" | "TAG" | "UNTAG" | "CATEGORY" | "ARCHIVE" | "RESTORE";
export async function bulkUpdate(db: Db, who: Who, p: { ids: string[]; action: BulkAction; value?: string }) {
  const ids = [...new Set(p.ids)].slice(0, 500);
  if (ids.length === 0) throw new ContactError("Select at least one contact.");
  // Only contacts this person can see are touched, so a forged id changes nothing
  const visible = await db.contact.findMany({ where: { AND: [contactScope(who), { id: { in: ids } }] }, select: { id: true, tags: true } });
  const vid = visible.map((v) => v.id);
  if (vid.length === 0) return 0;
  if (p.action === "ASSIGN") {
    if (!p.value || !(await db.user.findFirst({ where: { id: p.value, organizationId: who.organizationId, active: true, userType: "EMPLOYEE" } }))) throw new ContactError("Choose an active staff member.");
    if (!who.permissions.has("crm.view_all")) throw new ContactError("Only managers can reassign contacts.");
    await db.contact.updateMany({ where: { id: { in: vid } }, data: { ownerId: p.value } });
    await db.lead.updateMany({ where: { contactId: { in: vid }, clientId: null }, data: { assignedToId: p.value } });
  } else if (p.action === "CATEGORY") {
    if (!p.value || !(CATEGORIES as readonly string[]).includes(p.value)) throw new ContactError("Choose a category.");
    await db.contact.updateMany({ where: { id: { in: vid } }, data: { category: p.value } });
  } else if (p.action === "TAG" || p.action === "UNTAG") {
    const t = (p.value ?? "").trim().toLowerCase().slice(0, 30);
    if (!t) throw new ContactError("Enter a tag.");
    for (const v of visible) {
      const tags = p.action === "TAG" ? [...new Set([...v.tags, t])].slice(0, 12) : v.tags.filter((x) => x !== t);
      await db.contact.update({ where: { id: v.id }, data: { tags } });
      await db.lead.updateMany({ where: { contactId: v.id }, data: { tags } });
    }
  } else if (p.action === "ARCHIVE" || p.action === "RESTORE") {
    await db.contact.updateMany({ where: { id: { in: vid } }, data: { archived: p.action === "ARCHIVE" } });
  }
  return vid.length;
}

const csvCell = (v: unknown) => { let s = String(v ?? ""); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export function toCsv(rows: { name: string; kind: string; category: string; parentName?: string | null; primaryEmail: string | null; primaryPhone: string | null; city: string | null; country: string | null; source: string | null; tags: string[]; createdAt: Date }[]) {
  const head = ["Name", "Type", "Category", "Organization", "Email", "Phone", "City", "Country", "Source", "Tags", "Created"];
  return [head, ...rows.map((r) => [r.name, r.kind === "ORGANIZATION" ? "Organization" : "Person", r.category, r.parentName ?? "", r.primaryEmail, r.primaryPhone, r.city, r.country, r.source, r.tags.join("; "), r.createdAt.toISOString().slice(0, 10)])].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

// ---------- gamified daily goals ----------
export const DAILY_GOALS = { contacts: 5, activities: 10 };
export const LEVELS = ["Rookie", "Prospector", "Closer", "Rainmaker", "Legend"];

export async function questFor(db: Db, p: { organizationId: string; userId: string; now?: Date }) {
  const now = p.now ?? new Date();
  const dayStart = new Date(now); dayStart.setUTCHours(0, 0, 0, 0);
  const since = new Date(dayStart.getTime() - 60 * 86400000);
  const [madeToday, actToday, madeAll, actAll, conversions, verifiedCalls, recent, overdue] = await Promise.all([
    db.contact.count({ where: { organizationId: p.organizationId, createdById: p.userId, createdAt: { gte: dayStart } } }),
    db.contactActivity.count({ where: { actorId: p.userId, kind: { not: "SYSTEM" }, createdAt: { gte: dayStart }, contact: { organizationId: p.organizationId } } }),
    db.contact.count({ where: { organizationId: p.organizationId, createdById: p.userId } }),
    db.contactActivity.count({ where: { actorId: p.userId, kind: { not: "SYSTEM" }, contact: { organizationId: p.organizationId } } }),
    db.lead.count({ where: { organizationId: p.organizationId, assignedToId: p.userId, convertedAt: { not: null } } }),
    db.leadActivity.count({ where: { actorId: p.userId, kind: "CALL", outcome: "CONNECTED", verified: true } }),
    Promise.all([
      db.contact.findMany({ where: { organizationId: p.organizationId, createdById: p.userId, createdAt: { gte: since } }, select: { createdAt: true } }),
      db.contactActivity.findMany({ where: { actorId: p.userId, kind: { not: "SYSTEM" }, createdAt: { gte: since }, contact: { organizationId: p.organizationId } }, select: { createdAt: true } }),
    ]),
    db.lead.count({ where: { organizationId: p.organizationId, assignedToId: p.userId, clientId: null, stage: { isWon: false, isLost: false }, nextFollowUp: { lt: dayStart } } }),
  ]);
  const days = new Set([...recent[0], ...recent[1]].map((r) => r.createdAt.toISOString().slice(0, 10)));
  const today = dayStart.toISOString().slice(0, 10);
  let streak = 0;
  for (let i = days.has(today) ? 0 : 1; i < 61; i++) { const d = new Date(dayStart.getTime() - i * 86400000).toISOString().slice(0, 10); if (days.has(d)) streak++; else break; }
  const xp = madeAll * 10 + actAll * 5 + conversions * 100 + verifiedCalls * 15;
  const level = Math.min(LEVELS.length, Math.floor(Math.sqrt(xp / 60)) + 1);
  const need = (l: number) => Math.round((l - 1) ** 2 * 60);
  const badges = [
    { id: "first", label: "First contact", earned: madeAll >= 1 }, { id: "ten", label: "10 contacts added", earned: madeAll >= 10 }, { id: "hundred", label: "100 contacts added", earned: madeAll >= 100 },
    { id: "streak3", label: "3-day streak", earned: streak >= 3 }, { id: "streak7", label: "7-day streak", earned: streak >= 7 }, { id: "won", label: "First conversion", earned: conversions >= 1 },
    { id: "calls", label: "10 verified calls", earned: verifiedCalls >= 10 }, { id: "inbox", label: "No overdue follow-ups", earned: overdue === 0 && actAll > 0 },
  ];
  return {
    goals: [
      { id: "contacts", label: "Add contacts", value: madeToday, target: DAILY_GOALS.contacts }, { id: "activities", label: "Log activities", value: actToday, target: DAILY_GOALS.activities },
      { id: "overdue", label: "Clear overdue follow-ups", value: overdue === 0 ? 1 : 0, target: 1, detail: overdue > 0 ? `${overdue} overdue` : "All clear" },
    ],
    xp, level, levelName: LEVELS[level - 1], nextLevelAt: level >= LEVELS.length ? null : need(level + 1), levelStartsAt: need(level), streak, badges,
    allDone: madeToday >= DAILY_GOALS.contacts && actToday >= DAILY_GOALS.activities && overdue === 0,
  };
}

export const money = (v: string | null | undefined) => (v && dec(v).gt(0) ? v : null);
