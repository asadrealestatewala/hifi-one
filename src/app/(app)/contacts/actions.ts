"use server";

import { redirect } from "next/navigation";
import { audit, requirePermission } from "@/lib/auth";
import { ContactError, bulkUpdate, contactScope, createContact, findDuplicates, logContactActivity, mergeContacts, openOpportunityFor, setContactParent, updateContact, type BulkAction, type ContactInput, type Entry } from "@/lib/crm-contacts";
import { db } from "@/lib/db";
import { MailError, sendEmail } from "@/lib/mailer";
import { contactsAssigned } from "@/lib/events";
import { randomUUID } from "node:crypto";

export type FormState = { error?: string; duplicates?: { id: string; name: string; email: string | null; phone: string | null }[]; fieldHint?: string };

const s = (f: FormData, k: string) => String(f.get(k) ?? "");

function entries(f: FormData, prefix: "phone" | "email"): Entry[] {
  const types = f.getAll(`${prefix}Type`).map(String), values = f.getAll(`${prefix}Value`).map(String);
  return values.map((value, i) => ({ type: types[i] ?? "WORK", value })).filter((e) => e.value.trim());
}

function customFields(f: FormData): Record<string, string> {
  const keys = f.getAll("cfKey").map(String), vals = f.getAll("cfValue").map(String);
  const out: Record<string, string> = {};
  keys.forEach((k, i) => { if (k.trim() && (vals[i] ?? "").trim()) out[k.trim()] = vals[i]; });
  return out;
}

// Birthday, tax id, shipping address, social profiles and UTM tags: only present when the form carried them
function extras(f: FormData): Partial<ContactInput> {
  const out: Partial<ContactInput> = {};
  for (const k of ["birthday", "taxId", "shipAddressLine", "shipCity", "shipState", "shipCountry", "shipPostalCode"] as const) if (f.has(k)) out[k] = s(f, k);
  const group = (prefix: string) => { const o: Record<string, string> = {}; for (const [k, v] of f.entries()) if (k.startsWith(prefix)) o[k.slice(prefix.length)] = String(v); return Object.keys(o).length ? o : undefined; };
  const social = group("social_"), utm = group("utm_");
  if (social) out.social = social;
  if (utm) out.utm = utm;
  return out;
}

function parse(f: FormData): ContactInput {
  const kind = s(f, "kind") === "ORGANIZATION" ? "ORGANIZATION" : "PERSON";
  return {
    kind, title: s(f, "title"), firstName: s(f, "firstName"), lastName: s(f, "lastName"), name: s(f, "orgName"), parentName: s(f, "parentName"), category: s(f, "category") || "LEAD", industry: s(f, "industry"), jobTitle: s(f, "jobTitle"),
    ownerId: s(f, "ownerId") || undefined, followers: f.getAll("followers").map(String), website: s(f, "website"), phones: entries(f, "phone"), emails: entries(f, "email"), addressLine: s(f, "addressLine"), city: s(f, "city"),
    state: s(f, "state"), country: s(f, "country"), postalCode: s(f, "postalCode"), timezone: s(f, "timezone"), preferredContact: s(f, "preferredContact"), source: s(f, "source"), campaignId: s(f, "campaignId"),
    tags: s(f, "tags").split(",").map((x) => x.trim()).filter(Boolean), notes: s(f, "notes"), customFields: customFields(f),
    ...extras(f),
  };
}

export async function createContactAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requirePermission("crm.edit");
  let id: string;
  try {
    const opp = formData.get("openOpportunity") === "on";
    const c = await createContact(db, {
      organizationId: user.organizationId, actorId: user.id, input: parse(formData), confirmDuplicate: formData.get("confirmDuplicate") === "on",
      opportunity: opp ? { dealValue: s(formData, "dealValue").trim() || null, currency: s(formData, "currency") || "USD", serviceInterest: s(formData, "serviceInterest"), stageId: s(formData, "stageId") || null, expectedCloseDate: s(formData, "expectedCloseDate") || null } : null,
    });
    id = c.id;
    await audit(user, { action: "contact.create", entity: "Contact", entityId: c.id, after: { name: c.name, kind: c.kind, opportunity: opp } });
  } catch (e) {
    if (e instanceof ContactError) return { error: e.message, duplicates: e.duplicates };
    throw e;
  }
  redirect(s(formData, "addAnother") === "1" ? "/contacts?new=1&added=1" : `/contacts/${id}?created=1`);
}

export async function updateContactAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requirePermission("crm.edit");
  const id = s(formData, "id");
  if (!(await db.contact.findFirst({ where: { AND: [contactScope({ id: user.id, organizationId: user.organizationId, permissions: user.permissions }), { id }] }, select: { id: true } }))) redirect("/contacts");
  try {
    const input = parse(formData);
    // Only managers may reassign
    if (!user.permissions.has("crm.view_all")) delete input.ownerId;
    await updateContact(db, { organizationId: user.organizationId, id, actorId: user.id, patch: { ...input, parentId: undefined } });
    await audit(user, { action: "contact.update", entity: "Contact", entityId: id, after: { name: s(formData, "firstName") || s(formData, "orgName") } });
  } catch (e) {
    if (e instanceof ContactError) return { error: e.message, duplicates: e.duplicates };
    throw e;
  }
  redirect(`/contacts/${id}?saved=1`);
}

// Live duplicate hint while typing in the form.
export async function checkDuplicatesAction(email: string, phone: string, kind: string, name: string, excludeId?: string) {
  const user = await requirePermission("crm.view");
  const e = email.trim().toLowerCase();
  const emails = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) ? [e] : [];
  const phones = phone.replace(/[^\d+]/g, "").length >= 6 ? [phone] : [];
  const rows = await findDuplicates(db, user.organizationId, { emails, phones, name: kind === "ORGANIZATION" ? name : null, kind, excludeId });
  // Show only people this user may open, so the hint never reveals a record they cannot see
  const visible = await db.contact.findMany({ where: { AND: [contactScope({ id: user.id, organizationId: user.organizationId, permissions: user.permissions }), { id: { in: rows.map((r) => r.id) } }] }, select: { id: true } });
  const ok = new Set(visible.map((v) => v.id));
  return { duplicates: rows.filter((r) => ok.has(r.id)), hidden: rows.length - ok.size };
}

export type QuickResult = { ok: boolean; error?: string };

export async function quickUpdateAction(contactId: string, field: "phone" | "email" | "category" | "owner", value: string): Promise<QuickResult> {
  const user = await requirePermission("crm.edit");
  const who = { id: user.id, organizationId: user.organizationId, permissions: user.permissions };
  if (!(await db.contact.findFirst({ where: { AND: [contactScope(who), { id: contactId }] }, select: { id: true } }))) return { ok: false, error: "Contact not found." };
  try {
    const cur = await db.contact.findUniqueOrThrow({ where: { id: contactId } });
    if (field === "phone") { const list = (cur.phones as unknown as Entry[]).slice(); list[0] = { type: list[0]?.type ?? "WORK", value }; await updateContact(db, { organizationId: who.organizationId, id: contactId, actorId: user.id, patch: { phones: value.trim() ? list : list.slice(1) } }); }
    else if (field === "email") { const list = (cur.emails as unknown as Entry[]).slice(); list[0] = { type: list[0]?.type ?? "WORK", value }; await updateContact(db, { organizationId: who.organizationId, id: contactId, actorId: user.id, patch: { emails: value.trim() ? list : list.slice(1) } }); }
    else if (field === "category") await updateContact(db, { organizationId: who.organizationId, id: contactId, actorId: user.id, patch: { category: value } });
    else { if (!user.permissions.has("crm.view_all")) return { ok: false, error: "Only managers can reassign contacts." }; await bulkUpdate(db, who, { ids: [contactId], action: "ASSIGN", value }); await contactsAssigned(db, { toUserId: value, byUserId: user.id, count: 1, batchKey: randomUUID() }); }
    await audit(user, { action: "contact.quick_update", entity: "Contact", entityId: contactId, after: { field } });
    return { ok: true };
  } catch (e) {
    if (e instanceof ContactError) return { ok: false, error: e.message };
    throw e;
  }
}

export async function bulkAction(formData: FormData) {
  const user = await requirePermission("crm.edit");
  const ids = formData.getAll("ids").map(String);
  const action = s(formData, "action") as BulkAction;
  const back = s(formData, "returnTo").startsWith("/contacts") ? s(formData, "returnTo") : "/contacts";
  try {
    const n = await bulkUpdate(db, { id: user.id, organizationId: user.organizationId, permissions: user.permissions }, { ids, action, value: s(formData, "value") });
    await audit(user, { action: `contact.bulk_${action.toLowerCase()}`, entity: "Contact", after: { count: n } });
    if (action === "ASSIGN") await contactsAssigned(db, { toUserId: s(formData, "value"), byUserId: user.id, count: n, batchKey: randomUUID() });
    redirect(`${back}${back.includes("?") ? "&" : "?"}msg=${encodeURIComponent(`${n} contact${n === 1 ? "" : "s"} updated.`)}`);
  } catch (e) {
    if (e instanceof ContactError) redirect(`${back}${back.includes("?") ? "&" : "?"}error=${encodeURIComponent(e.message)}`);
    throw e;
  }
}

export async function logContactAction(formData: FormData) {
  const user = await requirePermission("crm.edit");
  const id = s(formData, "contactId");
  const back = `/contacts/${id}`;
  if (!(await db.contact.findFirst({ where: { AND: [contactScope({ id: user.id, organizationId: user.organizationId, permissions: user.permissions }), { id }] }, select: { id: true } }))) redirect("/contacts");
  try {
    const a = await logContactActivity(db, { organizationId: user.organizationId, contactId: id, actorId: user.id, kind: s(formData, "kind"), outcome: s(formData, "outcome") || undefined, body: s(formData, "body") });
    await audit(user, { action: "contact.activity", entity: "Contact", entityId: id, after: { kind: a.kind, outcome: a.outcome } });
  } catch (e) {
    if (e instanceof ContactError) redirect(`${back}?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  redirect(`${back}?logged=1`);
}

export async function openOpportunityAction(formData: FormData) {
  const user = await requirePermission("crm.edit");
  const id = s(formData, "contactId");
  if (!(await db.contact.findFirst({ where: { AND: [contactScope({ id: user.id, organizationId: user.organizationId, permissions: user.permissions }), { id }] }, select: { id: true } }))) redirect("/contacts");
  try {
    const l = await openOpportunityFor(db, { organizationId: user.organizationId, contactId: id, actorId: user.id, opp: { dealValue: s(formData, "dealValue").trim() || null, currency: s(formData, "currency") || "USD", serviceInterest: s(formData, "serviceInterest"), stageId: s(formData, "stageId") || null, expectedCloseDate: s(formData, "expectedCloseDate") || null } });
    await audit(user, { action: "contact.open_opportunity", entity: "Lead", entityId: l.id, after: { contactId: id } });
  } catch (e) {
    if (e instanceof ContactError) redirect(`/contacts/${id}?tab=deals&error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  redirect(`/contacts/${id}?tab=deals&opened=1`);
}

export async function mergeContactsAction(formData: FormData) {
  const user = await requirePermission("crm.edit");
  const intoId = s(formData, "intoId"), fromId = s(formData, "fromId");
  if (!user.permissions.has("crm.view_all")) redirect(`/contacts/${intoId}?error=${encodeURIComponent("Only managers can merge contacts.")}`);
  const who = { id: user.id, organizationId: user.organizationId, permissions: user.permissions };
  if ((await db.contact.count({ where: { AND: [contactScope(who), { id: { in: [intoId, fromId] } }] } })) !== 2) redirect("/contacts");
  try {
    const c = await mergeContacts(db, { organizationId: user.organizationId, actorId: user.id, intoId, fromId });
    await audit(user, { action: "contact.merge", entity: "Contact", entityId: c.id, after: { mergedFrom: fromId } });
  } catch (e) {
    if (e instanceof ContactError) redirect(`/contacts/${intoId}?merge=1&error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  redirect(`/contacts/${intoId}?merged=1`);
}

export async function sendContactEmailAction(formData: FormData) {
  const user = await requirePermission("crm.edit");
  const id = s(formData, "contactId");
  const back = `/contacts/${id}?tab=email`;
  const c = await db.contact.findFirst({ where: { AND: [contactScope({ id: user.id, organizationId: user.organizationId, permissions: user.permissions }), { id }] } });
  if (!c) redirect("/contacts");
  const to = s(formData, "to").trim().toLowerCase();
  // Only an address that is on this contact's record, never a free-typed one
  if (!(c.emails as unknown as Entry[]).some((e) => e.value === to)) redirect(`${back}&error=${encodeURIComponent("Choose one of this contact's email addresses.")}`);
  try {
    const m = await sendEmail(db, { organizationId: user.organizationId, to, subject: s(formData, "subject"), text: s(formData, "body"), relatedType: "CONTACT", relatedId: c.id, actorId: user.id });
    if (m.status === "SENT") await logContactActivity(db, { organizationId: user.organizationId, contactId: c.id, actorId: user.id, kind: "EMAIL", body: `Emailed ${to}: ${m.subject}` });
    await audit(user, { action: "contact.email", entity: "Contact", entityId: c.id, after: { status: m.status } });
    if (m.status !== "SENT") redirect(`${back}&error=${encodeURIComponent(m.status === "NOT_CONFIGURED" ? "No mail account is connected, so nothing was sent. The attempt is listed below." : `The mail server refused it: ${m.error ?? "unknown error"}`)}`);
  } catch (e) {
    if (e instanceof MailError || e instanceof ContactError) redirect(`${back}&error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  redirect(`${back}&sent=1`);
}

export type SectionName = "summary" | "contacts" | "organization" | "followers" | "tags" | "description" | "billing" | "shipping" | "details" | "more" | "custom";

// One section of the contact page saved on its own. Only the fields of that section are sent to the library; everything else is left as it was.
export async function updateContactSectionAction(contactId: string, section: SectionName, formData: FormData): Promise<QuickResult> {
  const user = await requirePermission("crm.edit");
  const who = { id: user.id, organizationId: user.organizationId, permissions: user.permissions };
  const cur = await db.contact.findFirst({ where: { AND: [contactScope(who), { id: contactId }] } });
  if (!cur) return { ok: false, error: "Contact not found." };
  const f = parse(formData);
  const patches: Record<SectionName, ContactInput | null> = {
    summary: { website: f.website, industry: f.industry, category: f.category, birthday: f.birthday, ...(user.permissions.has("crm.view_all") && f.ownerId ? { ownerId: f.ownerId } : {}) },
    contacts: { phones: f.phones, emails: f.emails, preferredContact: f.preferredContact, timezone: f.timezone },
    organization: null,
    followers: { followers: f.followers },
    tags: { tags: f.tags },
    description: { notes: f.notes },
    billing: { addressLine: f.addressLine, city: f.city, state: f.state, country: f.country, postalCode: f.postalCode },
    shipping: { shipAddressLine: f.shipAddressLine, shipCity: f.shipCity, shipState: f.shipState, shipCountry: f.shipCountry, shipPostalCode: f.shipPostalCode },
    details: cur.kind === "ORGANIZATION" ? { name: f.name, taxId: f.taxId } : { title: f.title, firstName: f.firstName, lastName: f.lastName, taxId: f.taxId, jobTitle: f.jobTitle },
    more: { social: f.social, utm: f.utm, source: f.source },
    custom: { customFields: f.customFields },
  };
  if (!(section in patches)) return { ok: false, error: "Unknown section." };
  try {
    if (section === "organization") await setContactParent(db, { organizationId: user.organizationId, contactId, actorId: user.id, parentName: s(formData, "parentName") });
    else await updateContact(db, { organizationId: user.organizationId, id: contactId, actorId: user.id, patch: patches[section]! });
    await audit(user, { action: "contact.update_section", entity: "Contact", entityId: contactId, after: { section } });
    return { ok: true };
  } catch (e) {
    if (e instanceof ContactError) return { ok: false, error: e.message };
    throw e;
  }
}
