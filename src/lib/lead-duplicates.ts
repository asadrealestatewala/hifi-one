// One person, one lead (decision 65). A lead is never added twice for the same phone number or email, whatever status the first one is in
// (Not interested and Closed Lost leads still count: they are leads for good, never prospects again). Every way of creating a lead goes through
// guardNewLead + claimLeadKeys (or createLeadGuarded, which does both in one transaction), so manual add, website forms, worklist conversion,
// opportunities opened from a contact and Prospector's send-to-CRM all follow the same rule. Free of Next.js imports so it can be tested.
//
// Layers: (1) normalise (email lowercased, phone to +E.164, local numbers anchored to the organization's default country),
// (2) a per-key advisory lock so two agents saving at once take turns, (3) the check, (4) LeadKey rows with a unique index as the database backstop.
import type { Prisma, PrismaClient } from "@prisma/client";
import { normalizeEmail } from "./contacts";
import { CALLING_CODES, countryOptions, normalizeE164, phoneTail } from "./phone";

type Db = PrismaClient | Prisma.TransactionClient;
type Tx = Prisma.TransactionClient;

export const DUP_MODES = ["BLOCK", "WARN", "OFF"] as const;
export type DupMode = (typeof DUP_MODES)[number];
export const DUP_MODE_LABEL: Record<DupMode, string> = { BLOCK: "Block it", WARN: "Warn, let the agent confirm", OFF: "Do not check" };
export type Policy = { mode: DupMode; defaultCountry: string };
export const DEFAULT_POLICY: Policy = { mode: "BLOCK", defaultCountry: "PK" };

export async function getPolicy(db: Db, organizationId: string): Promise<Policy> {
  const row = await db.crmSettings.findUnique({ where: { organizationId } });
  if (!row) return DEFAULT_POLICY;
  return { mode: (DUP_MODES as readonly string[]).includes(row.duplicateMode) ? (row.duplicateMode as DupMode) : "BLOCK", defaultCountry: row.defaultCountry };
}

export async function savePolicy(db: Db, organizationId: string, p: Policy) {
  if (!(DUP_MODES as readonly string[]).includes(p.mode)) throw new Error("Choose block, warn or off.");
  if (!(p.defaultCountry in CALLING_CODES)) throw new Error("Choose one of the listed countries.");
  await db.crmSettings.upsert({ where: { organizationId }, create: { organizationId, duplicateMode: p.mode, defaultCountry: p.defaultCountry }, update: { duplicateMode: p.mode, defaultCountry: p.defaultCountry } });
}

// ---------- normalising ----------
// A lead's country is free text ("Pakistan"); map it to a calling-code country when it is one we know, otherwise use the default.
let nameToIso: Map<string, string> | null = null;
function isoFor(country: string | null | undefined, fallback: string): string {
  const c = (country ?? "").trim();
  if (!c) return fallback;
  if (/^[A-Za-z]{2}$/.test(c) && c.toUpperCase() in CALLING_CODES) return c.toUpperCase();
  nameToIso ??= new Map(countryOptions().map((o) => [o.name.toLowerCase(), o.code]));
  const iso = nameToIso.get(c.toLowerCase());
  return iso && iso in CALLING_CODES ? iso : fallback;
}
const looseKey = (p: string) => { const d = p.replace(/[^\d+]/g, ""); return d.length >= 6 ? d.replace(/^00/, "+") : null; };

export type LeadKeys = { email: string | null; phone: string | null; phoneCandidates: string[]; tail: string | null };
// phone is the canonical claim (+E.164 when it can be worked out); phoneCandidates adds the plain digits form older records were stored in.
export function leadKeys(p: { email?: string | null; phone?: string | null; country?: string | null }, defaultCountry: string): LeadKeys {
  const email = normalizeEmail(p.email);
  const raw = (p.phone ?? "").trim();
  const canonical = raw ? normalizeE164(raw, isoFor(p.country, defaultCountry)) : null;
  const loose = raw ? looseKey(raw) : null;
  const phoneCandidates = [...new Set([canonical, loose].filter(Boolean) as string[])];
  return { email, phone: canonical ?? loose, phoneCandidates, tail: phoneTail(canonical ?? loose) };
}

// ---------- the check ----------
export type DupMatch = {
  leadId: string; number: number; name: string; stageName: string; closed: "WON" | "LOST" | null;
  ownerId: string | null; ownerName: string | null; createdById: string | null; matchedOn: ("email" | "phone")[];
};
export type Viewer = { id: string; permissions: ReadonlySet<string> };

export class DuplicateLeadError extends Error {
  constructor(message: string, readonly matches: DupMatch[], readonly canConfirm = false) { super(message); this.name = "DuplicateLeadError"; }
}

export async function findLeadDuplicates(db: Db, p: { organizationId: string; email?: string | null; phone?: string | null; country?: string | null; excludeLeadId?: string; excludeContactId?: string | null }, policy: Policy): Promise<DupMatch[]> {
  const k = leadKeys(p, policy.defaultCountry);
  const or: Prisma.LeadWhereInput[] = [];
  if (k.email) or.push({ email: { equals: k.email, mode: "insensitive" } }, { keys: { some: { kind: "EMAIL", key: k.email } } });
  if (k.phoneCandidates.length) {
    or.push({ phone: { in: k.phoneCandidates } }, { keys: { some: { kind: "PHONE", key: { in: k.phoneCandidates } } } });
    // older leads were stored as typed (03001234567): the same number is recognised by its last nine digits
    if (k.tail) or.push({ phone: { endsWith: k.tail } });
  }
  if (or.length === 0) return [];
  const rows = await db.lead.findMany({
    where: {
      organizationId: p.organizationId, ...(p.excludeLeadId ? { id: { not: p.excludeLeadId } } : {}), OR: or,
      // another deal for the same contact is not a duplicate person
      ...(p.excludeContactId ? { AND: [{ OR: [{ contactId: null }, { contactId: { not: p.excludeContactId } }] }] } : {}),
    },
    orderBy: { createdAt: "asc" }, take: 5,
    select: { id: true, number: true, name: true, email: true, phone: true, assignedToId: true, createdById: true, stage: { select: { name: true, isWon: true, isLost: true } } },
  });
  const ownerIds = [...new Set(rows.map((r) => r.assignedToId).filter(Boolean) as string[])];
  const owners = ownerIds.length ? await db.user.findMany({ where: { id: { in: ownerIds } }, select: { id: true, name: true } }) : [];
  return rows.map((r) => {
    const rk = leadKeys({ email: r.email, phone: r.phone, country: p.country }, policy.defaultCountry);
    const matchedOn: ("email" | "phone")[] = [];
    if (k.email && (rk.email === k.email)) matchedOn.push("email");
    if (k.phoneCandidates.length && (rk.phoneCandidates.some((c) => k.phoneCandidates.includes(c)) || (k.tail && rk.tail === k.tail) || (r.phone && k.tail && r.phone.endsWith(k.tail)))) matchedOn.push("phone");
    if (matchedOn.length === 0) matchedOn.push(k.email ? "email" : "phone"); // matched through a claim row
    return { leadId: r.id, number: r.number, name: r.name, stageName: r.stage.name, closed: r.stage.isWon ? "WON" : r.stage.isLost ? "LOST" : null, ownerId: r.assignedToId, ownerName: owners.find((o) => o.id === r.assignedToId)?.name ?? null, createdById: r.createdById, matchedOn };
  });
}

// What a person may be told. Owner name and a link only when they may open that lead (their own, or a manager who sees all);
// everyone else gets a generic line that reveals nothing about the other lead.
export function presentDuplicate(m: DupMatch, viewer: Viewer | null): { text: string; href: string | null; detail: boolean } {
  const on = m.matchedOn.length === 2 ? "phone number and email" : m.matchedOn[0] === "email" ? "email" : "phone number";
  const mine = !!viewer && (viewer.permissions.has("crm.view_all") || m.ownerId === viewer.id || m.createdById === viewer.id);
  if (!mine) return { text: `A lead with this ${on} already exists and belongs to another team member. Ask a sales manager if it should be reassigned or reopened.`, href: null, detail: false };
  const status = m.closed === "LOST" ? `${m.stageName} (closed)` : m.stageName;
  return { text: `A lead with this ${on} already exists: ${m.name} (L-${m.number}), status ${status}, owned by ${m.ownerName ?? "nobody yet"}.`, href: `/leads/${m.leadId}`, detail: true };
}

async function lockKeys(tx: Tx, organizationId: string, k: LeadKeys) {
  const names = [k.email && `E:${k.email}`, k.phone && `P:${k.phone}`].filter(Boolean).sort() as string[];
  for (const n of names) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`lead-key:${organizationId}:${n}`}, 0))`;
}

export type Guard = { policy: Policy; keys: LeadKeys; matches: DupMatch[] };

// Call inside the transaction that creates the lead, before the create. Throws DuplicateLeadError in BLOCK mode, and in WARN mode unless confirmed.
export async function guardNewLead(tx: Tx, p: { organizationId: string; email?: string | null; phone?: string | null; country?: string | null; confirm?: boolean; excludeLeadId?: string; excludeContactId?: string | null }): Promise<Guard> {
  const policy = await getPolicy(tx, p.organizationId);
  const keys = leadKeys(p, policy.defaultCountry);
  if (policy.mode === "OFF") return { policy, keys, matches: [] };
  await lockKeys(tx, p.organizationId, keys);
  const matches = await findLeadDuplicates(tx, p, policy);
  if (matches.length && (policy.mode === "BLOCK" || !p.confirm)) {
    throw new DuplicateLeadError(presentDuplicate(matches[0], null).text, matches, policy.mode === "WARN");
  }
  return { policy, keys, matches };
}

// Records the lead's claim on its keys. In BLOCK mode a claim somebody else already holds means the guard was bypassed or raced: the error rolls the transaction back.
export async function claimLeadKeys(tx: Tx, p: { leadId: string; organizationId: string; email?: string | null; phone?: string | null; country?: string | null }, opts: { policy?: Policy; strict?: boolean } = {}) {
  const policy = opts.policy ?? (await getPolicy(tx, p.organizationId));
  const k = leadKeys(p, policy.defaultCountry);
  await tx.leadKey.deleteMany({ where: { leadId: p.leadId } });
  const rows = [k.email && { kind: "EMAIL", key: k.email }, k.phone && { kind: "PHONE", key: k.phone }].filter(Boolean) as { kind: string; key: string }[];
  if (rows.length === 0) return;
  const made = await tx.leadKey.createMany({ data: rows.map((r) => ({ ...r, organizationId: p.organizationId, leadId: p.leadId })), skipDuplicates: true });
  if (made.count < rows.length && policy.mode === "BLOCK" && opts.strict !== false) {
    const matches = await findLeadDuplicates(tx, { ...p, excludeLeadId: p.leadId }, policy);
    throw new DuplicateLeadError(presentDuplicate(matches[0] ?? { leadId: "", number: 0, name: "", stageName: "", closed: null, ownerId: null, ownerName: null, createdById: null, matchedOn: [k.email ? "email" : "phone"] }, null).text, matches);
  }
}

// Create a lead safely: lock, check, create, claim, all in one transaction.
export async function createLeadGuarded<T extends { id: string }>(
  db: PrismaClient, p: { organizationId: string; email?: string | null; phone?: string | null; country?: string | null; confirm?: boolean }, create: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.$transaction(async (tx) => {
    const g = await guardNewLead(tx, p);
    const lead = await create(tx);
    await claimLeadKeys(tx, { leadId: lead.id, organizationId: p.organizationId, email: p.email, phone: p.phone, country: p.country }, { policy: g.policy });
    return lead;
  });
}

// After a contact edit changes email or phone on its leads: keep the claims in step. Never blocks (the contact screen has its own duplicate check).
export async function resyncLeadKeys(tx: Tx, leadIds: string[]) {
  if (leadIds.length === 0) return;
  const leads = await tx.lead.findMany({ where: { id: { in: leadIds } }, select: { id: true, organizationId: true, email: true, phone: true, country: true } });
  for (const l of leads) await claimLeadKeys(tx, { leadId: l.id, organizationId: l.organizationId, email: l.email, phone: l.phone, country: l.country }, { strict: false });
}

// ---------- existing data ----------
export type DupGroup = { kind: "EMAIL" | "PHONE"; key: string; leads: { id: string; number: number; name: string; stageName: string; ownerName: string | null; createdAt: Date; hasClaim: boolean }[] };

// Read-only: groups of leads that share a normalised email or phone. Nothing is changed.
export async function scanLeadDuplicates(db: Db, organizationId: string): Promise<{ total: number; groups: DupGroup[] }> {
  const policy = await getPolicy(db, organizationId);
  const [leads, claims] = await Promise.all([
    db.lead.findMany({ where: { organizationId }, orderBy: { createdAt: "asc" }, select: { id: true, number: true, name: true, email: true, phone: true, country: true, createdAt: true, stage: { select: { name: true } }, assignedToId: true } }),
    db.leadKey.findMany({ where: { organizationId }, select: { leadId: true } }),
  ]);
  const owners = new Map((await db.user.findMany({ where: { organizationId }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const claimed = new Set(claims.map((c) => c.leadId));
  const by = new Map<string, DupGroup>();
  for (const l of leads) {
    const k = leadKeys(l, policy.defaultCountry);
    for (const [kind, key] of [["EMAIL", k.email], ["PHONE", k.phone]] as const) {
      if (!key) continue;
      const id = `${kind}:${key}`;
      const g = by.get(id) ?? { kind, key, leads: [] };
      g.leads.push({ id: l.id, number: l.number, name: l.name, stageName: l.stage.name, ownerName: l.assignedToId ? owners.get(l.assignedToId) ?? null : null, createdAt: l.createdAt, hasClaim: claimed.has(l.id) });
      by.set(id, g);
    }
  }
  const groups = [...by.values()].filter((g) => g.leads.length > 1).sort((a, b) => b.leads.length - a.leads.length || a.key.localeCompare(b.key));
  return { total: leads.length, groups };
}

// Gives every existing lead its claim, oldest first, so the first of a duplicate pair keeps the key. Never deletes or edits a lead. Safe to repeat.
export async function backfillLeadKeys(db: PrismaClient, organizationId: string): Promise<{ leads: number; claimsAdded: number; leftUnclaimed: number }> {
  const policy = await getPolicy(db, organizationId);
  const leads = await db.lead.findMany({ where: { organizationId }, orderBy: { createdAt: "asc" }, select: { id: true, email: true, phone: true, country: true } });
  let added = 0, left = 0;
  for (const l of leads) {
    const k = leadKeys(l, policy.defaultCountry);
    const rows = [k.email && { kind: "EMAIL", key: k.email }, k.phone && { kind: "PHONE", key: k.phone }].filter(Boolean) as { kind: string; key: string }[];
    if (rows.length === 0) continue;
    await db.leadKey.deleteMany({ where: { leadId: l.id } });
    const made = await db.leadKey.createMany({ data: rows.map((r) => ({ ...r, organizationId, leadId: l.id })), skipDuplicates: true });
    added += made.count; left += rows.length - made.count;
  }
  return { leads: leads.length, claimsAdded: added, leftUnclaimed: left };
}

// One way to store a phone number on a lead, however it was typed: +international when it can be worked out (a local 0300 number is read
// in the lead's country, else the organization's default country), otherwise the digits as typed. Keeps stored numbers, claims and tel: links alike.
export async function canonicalPhone(db: Db, organizationId: string, raw: string | null | undefined, country?: string | null): Promise<string | null> {
  if (!(raw ?? "").trim()) return null;
  const policy = await getPolicy(db, organizationId);
  return leadKeys({ phone: raw, country }, policy.defaultCountry).phone;
}

// Is this phone or email already a client's? Clients are few, and their phones were typed freely (0300-1234567), so the list is read and
// compared by the last nine digits, the same way do-not-contact numbers are. Used before a business is added as a prospect (decision 71).
export async function findClientMatch(db: Db, organizationId: string, p: { phone?: string | null; email?: string | null }): Promise<{ id: string; name: string; code: string | null } | null> {
  const email = normalizeEmail(p.email);
  const tail = phoneTail(p.phone);
  if (!email && !tail) return null;
  const rows = await db.client.findMany({
    where: { organizationId, OR: [...(email ? [{ email: { equals: email, mode: "insensitive" as const } }] : []), ...(tail ? [{ phone: { not: null } }] : [])] },
    select: { id: true, name: true, code: true, phone: true, email: true }, orderBy: { createdAt: "asc" },
  });
  const hit = rows.find((c) => (email && normalizeEmail(c.email) === email) || (tail && phoneTail(c.phone) === tail));
  return hit ? { id: hit.id, name: hit.name, code: hit.code } : null;
}

// Is this phone or email on the do-not-contact list? Phones match by their last nine digits, so 0300 1234567 and +92 300 1234567 are the same
// number, and emails ignore case. Every place that adds or converts a contact asks this one question.
export async function isSuppressed(db: Db, organizationId: string, p: { phone?: string | null; email?: string | null }): Promise<boolean> {
  const email = normalizeEmail(p.email);
  const tail = phoneTail(p.phone);
  if (!email && !tail) return false;
  return (await suppressionMatcher(db, organizationId))(p);
}

// The same rule for a whole file: the list is read once, then each row is asked. Used by the prospect import so 1,000 rows are not 1,000 reads.
export async function suppressionMatcher(db: Db, organizationId: string): Promise<(p: { phone?: string | null; email?: string | null }) => boolean> {
  const rows = await db.suppressedContact.findMany({ where: { organizationId }, select: { phone: true, email: true } });
  const emails = new Set(rows.map((r) => normalizeEmail(r.email)).filter(Boolean) as string[]);
  const tails = new Set(rows.map((r) => phoneTail(r.phone)).filter(Boolean) as string[]);
  return (p) => {
    const email = normalizeEmail(p.email);
    const tail = phoneTail(p.phone);
    return Boolean((email && emails.has(email)) || (tail && tails.has(tail)));
  };
}
