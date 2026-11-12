// Field sales (decision 71). Each SaaS product (Agentify ERP, Velocity ERP, Pharmivo) has two kinds of salespeople: office agents who
// cold-call and add prospects from their desk, and field agents who walk business to business. A field agent logs every visit, whatever
// happened (shop closed, owner absent, not interested, interested, demo requested), with the place they stood and photos of the premises
// and the visiting card. The business is a Prospect; each trip is a ProspectVisit, so going back later never makes a second prospect.
//
// Rules:
//   - One business, one prospect per product. The same phone or email already held by a prospect of the same product is refused and the
//     second agent is told it is already a prospect (business name, product, date), nothing more about it. The same business may be a
//     prospect of another product; the agent is told that too, as information only.
//   - A business that is already a CRM lead, or a client, is refused whatever the product (one person, one lead: decision 65).
//   - A visit without a phone or email is still saved ("needs details"): it counts towards the day's target but cannot become a lead until
//     a phone or email is added. Such a prospect is recognised again by its name and place (same name within 75 m), as a warning the agent
//     can override, because chain shops share a name.
//   - Location is read once, when the visit is saved. Nobody is tracked between visits.
//   - Interested and Demo requested keep the prospect a prospect; the demo booking (phase 3) is what makes it a lead.
// Free of Next.js imports so it can be tested against the database.
import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { normalizeEmail } from "./contacts";
import { findClientMatch, findLeadDuplicates, getPolicy, isSuppressed, presentDuplicate } from "./lead-duplicates";
import { isCountry, normalizeE164, phoneProblem, phoneTail } from "./phone";
import { rescoreProspects } from "./prospect-scoring";
import { isManager, ProspectorError, type Actor } from "./prospector";
import { notify, usersWithPermission } from "./notifications";

type Db = PrismaClient;
type Tx = Prisma.TransactionClient;

export const AGENT_KINDS = ["OFFICE", "FIELD"] as const;
export type AgentKind = (typeof AGENT_KINDS)[number];
export const AGENT_KIND_LABEL: Record<AgentKind, string> = { OFFICE: "Office (cold calling)", FIELD: "Field (visits businesses)" };

export const VISIT_OUTCOMES = ["NOT_AVAILABLE", "CLOSED", "OWNER_ABSENT", "NOT_INTERESTED", "INTERESTED", "DEMO_REQUESTED"] as const;
export type VisitOutcome = (typeof VISIT_OUTCOMES)[number];
export const VISIT_OUTCOME_LABEL: Record<VisitOutcome, string> = {
  NOT_AVAILABLE: "Not available", CLOSED: "Closed", OWNER_ABSENT: "Owner absent", NOT_INTERESTED: "Not interested", INTERESTED: "Interested", DEMO_REQUESTED: "Demo requested",
};
// Outcomes after which the agent should go back. DEMO_CANCELLED is not a visit outcome: the onboarding team sets it on the prospect when a
// requested demo could not be booked (decision 73), so the agent sees the shop in the go-back list again.
export const DEMO_CANCELLED = "DEMO_CANCELLED";
export const REVISIT_OUTCOMES: readonly string[] = ["NOT_AVAILABLE", "CLOSED", "OWNER_ABSENT", DEMO_CANCELLED];
export const LAST_OUTCOME_LABEL: Record<string, string> = { ...VISIT_OUTCOME_LABEL, [DEMO_CANCELLED]: "Demo cancelled" };
export const FIELD_SOURCE = "FIELD_VISIT"; // Prospect.sourceLabel for a prospect that began as a visit
export const DEFAULT_DAILY_TARGET = 40;
export const MAX_PHOTOS_PER_VISIT = 6; // one visiting card, the rest the premises
export const SAME_PLACE_METRES = 75;
const MAX_VISIT_AGE_DAYS = 30; // an offline phone may send a visit days later, not months
const CLOSED_FOR_VISITS = ["SENT_TO_CRM", "DISMISSED"];

const clean = (v: unknown, max: number) => String(v ?? "").replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const cleanNote = (v: unknown, max: number) => String(v ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim().slice(0, max);
const dayStart = (d: Date, tzOffsetMinutes: number) => { const local = new Date(d.getTime() + tzOffsetMinutes * 60_000); const s = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()); return new Date(s - tzOffsetMinutes * 60_000); };
export const canReview = (a: Actor) => a.permissions.has("field.review");

// ---------- products ----------
export type ProductInput = { id?: string; code?: string; name?: string; businessLabel?: string; website?: string; dailyVisitTarget?: number | string; active?: boolean; sortOrder?: number | string };

export const listProducts = (db: Db, organizationId: string, opts: { activeOnly?: boolean } = {}) =>
  db.saasProduct.findMany({ where: { organizationId, ...(opts.activeOnly ? { active: true } : {}) }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });

export async function saveProduct(db: Db, actor: Actor, input: ProductInput) {
  if (!canReview(actor)) throw new ProspectorError("Only a sales manager can change the list of solutions.");
  const org = actor.organizationId;
  const name = clean(input.name, 80);
  if (!name) throw new ProspectorError("Enter the solution's name.", "name");
  const businessLabel = clean(input.businessLabel, 60);
  if (!businessLabel) throw new ProspectorError("Say what kind of business a prospect is (for example Pharmacy).", "businessLabel");
  const code = clean(input.code, 24).toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "") || name.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 24);
  if (!code) throw new ProspectorError("The solution needs a short code made of letters and digits.", "code");
  const target = Number(input.dailyVisitTarget ?? DEFAULT_DAILY_TARGET);
  if (!Number.isInteger(target) || target < 0 || target > 500) throw new ProspectorError("The daily visit target must be a whole number from 0 to 500.", "dailyVisitTarget");
  const sortOrder = Number(input.sortOrder ?? 0);
  const website = clean(input.website, 200) || null;
  if (website && !/^https?:\/\/[^\s/]+\.[^\s]+$/i.test(website)) throw new ProspectorError("The website must start with http:// or https://.", "website");
  const data = { name, businessLabel, code, website, dailyVisitTarget: target, active: input.active ?? true, sortOrder: Number.isInteger(sortOrder) ? sortOrder : 0 };
  if (input.id) {
    const row = await db.saasProduct.findFirst({ where: { id: input.id, organizationId: org }, select: { id: true } });
    if (!row) throw new ProspectorError("That solution no longer exists.");
    const clash = await db.saasProduct.findFirst({ where: { organizationId: org, code, id: { not: row.id } }, select: { id: true } });
    if (clash) throw new ProspectorError(`Another solution already uses the code ${code}.`, "code");
    return db.saasProduct.update({ where: { id: row.id }, data });
  }
  if (await db.saasProduct.findFirst({ where: { organizationId: org, code }, select: { id: true } })) throw new ProspectorError(`A product with the code ${code} already exists.`, "code");
  return db.saasProduct.create({ data: { organizationId: org, ...data } });
}

// ---------- agent profiles ----------
export type Profile = { userId: string; productId: string | null; productName: string | null; businessLabel: string | null; kind: AgentKind; dailyVisitTarget: number };

export async function agentProfile(db: Db, organizationId: string, userId: string): Promise<Profile> {
  const row = await db.salesAgentProfile.findUnique({ where: { organizationId_userId: { organizationId, userId } }, include: { product: true } });
  const kind: AgentKind = row?.kind === "FIELD" ? "FIELD" : "OFFICE";
  return { userId, productId: row?.productId ?? null, productName: row?.product?.name ?? null, businessLabel: row?.product?.businessLabel ?? null, kind, dailyVisitTarget: row?.dailyVisitTarget ?? row?.product?.dailyVisitTarget ?? DEFAULT_DAILY_TARGET };
}

export async function setAgentProfile(db: Db, actor: Actor, p: { userId: string; productId: string | null; kind: string; dailyVisitTarget: number | string | null }) {
  if (!canReview(actor)) throw new ProspectorError("Only a sales manager can change who works which solution.");
  const org = actor.organizationId;
  if (!(AGENT_KINDS as readonly string[]).includes(p.kind)) throw new ProspectorError("Choose office or field.", "kind");
  const user = await db.user.findFirst({ where: { id: p.userId, organizationId: org, userType: "EMPLOYEE" }, select: { id: true } });
  if (!user) throw new ProspectorError("That person is not a staff member of this organization.");
  if (p.productId) {
    const prod = await db.saasProduct.findFirst({ where: { id: p.productId, organizationId: org }, select: { id: true } });
    if (!prod) throw new ProspectorError("Choose one of the listed products.", "productId");
  }
  let target: number | null = null;
  if (p.dailyVisitTarget !== null && String(p.dailyVisitTarget).trim() !== "") {
    target = Number(p.dailyVisitTarget);
    if (!Number.isInteger(target) || target < 0 || target > 500) throw new ProspectorError("A person's daily target must be a whole number from 0 to 500.", "dailyVisitTarget");
  }
  return db.salesAgentProfile.upsert({
    where: { organizationId_userId: { organizationId: org, userId: p.userId } },
    create: { organizationId: org, userId: p.userId, productId: p.productId, kind: p.kind, dailyVisitTarget: target, updatedById: actor.id },
    update: { productId: p.productId, kind: p.kind, dailyVisitTarget: target, updatedById: actor.id },
  });
}

// Everyone who can add prospects, with their product and kind, for the manager's page
export async function salesTeam(db: Db, organizationId: string) {
  const ids = await usersWithPermission(db, organizationId, "crm.edit");
  const [users, profiles] = await Promise.all([
    db.user.findMany({ where: { id: { in: ids }, userType: "EMPLOYEE", active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.salesAgentProfile.findMany({ where: { organizationId, userId: { in: ids } } }),
  ]);
  const byUser = new Map(profiles.map((p) => [p.userId, p]));
  return users.map((u) => { const p = byUser.get(u.id); return { ...u, productId: p?.productId ?? null, kind: (p?.kind === "FIELD" ? "FIELD" : "OFFICE") as AgentKind, dailyVisitTarget: p?.dailyVisitTarget ?? null }; });
}

// ---------- who already has this business ----------
export type Match =
  | { kind: "CLIENT"; id: string; name: string; code: string | null }
  | { kind: "LEAD"; id: string; name: string; number: number; text: string }
  | { kind: "PROSPECT"; id: string; name: string; productId: string | null; productName: string | null; createdAt: Date; sameProduct: boolean; mine: boolean; status: string; by: "key" | "place" };

const fmtDate = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
export const normalizedName = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
export function metresBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371000, toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// The sentence the agent reads. A match in another product is information; a lead or client is a refusal; a prospect of the same product is a
// refusal unless it is the agent's own (then the visit is added to it).
export function describeMatch(m: Match, productName: string | null): string {
  if (m.kind === "CLIENT") return `${m.name}${m.code ? ` (${m.code})` : ""} is already a client of ours. Nothing to add here; tell your manager if they want to buy another solution.`;
  if (m.kind === "LEAD") return m.text;
  const when = `added ${fmtDate(m.createdAt)}`;
  if (!m.sameProduct) return `${m.name} is also a prospect for ${m.productName ?? "another solution"} (${when}). That is fine: it is kept separately for ${productName ?? "your solution"}.`;
  if (m.by === "place") return `${m.name} looks like the same business as a prospect ${when} nearby. If it is the same shop, add your visit to it; if it is a different branch, tick "Different business" and save again.`;
  return `${m.name} is already a prospect for ${m.productName ?? productName ?? "this solution"} (${when}) and belongs to another team member. Ask a sales manager if it should be reassigned.`;
}

export async function findMatches(tx: Tx | Db, actor: Actor, p: { phone: string | null; email: string | null; productId: string | null; name?: string; lat?: number | null; lng?: number | null }): Promise<Match[]> {
  const org = actor.organizationId;
  const tail = phoneTail(p.phone);
  const out: Match[] = [];
  const policy = await getPolicy(tx, org);
  const mine = (r: { assignedToId: string | null; addedById: string | null }) => r.assignedToId === actor.id || r.addedById === actor.id;
  if (tail || p.email) {
    const client = await findClientMatch(tx, org, { phone: p.phone, email: p.email });
    if (client) out.push({ kind: "CLIENT", id: client.id, name: client.name, code: client.code });
    const lead = (await findLeadDuplicates(tx, { organizationId: org, phone: p.phone, email: p.email }, policy))[0];
    if (lead) out.push({ kind: "LEAD", id: lead.leadId, name: lead.name, number: lead.number, text: presentDuplicate(lead, { id: actor.id, permissions: actor.permissions }).text });
    const ors: Prisma.ProspectWhereInput[] = [];
    if (p.email) ors.push({ email: { equals: p.email, mode: "insensitive" } });
    if (tail) ors.push({ phone: { endsWith: tail } });
    const rows = await tx.prospect.findMany({ where: { organizationId: org, OR: ors }, orderBy: { createdAt: "asc" }, include: { product: { select: { name: true } } } });
    for (const r of rows) out.push({ kind: "PROSPECT", id: r.id, name: r.name, productId: r.productId, productName: r.product?.name ?? null, createdAt: r.createdAt, sameProduct: (r.productId ?? null) === (p.productId ?? null), mine: mine(r), status: r.status, by: "key" });
  }
  // A prospect logged without any phone or email (shop was closed) is recognised by its name within 75 m, in this product, so the agent who
  // comes back with the number fills it in instead of making a second prospect. Only when no prospect of this product holds the key already.
  if (p.name && !out.some((m) => m.kind === "PROSPECT" && m.sameProduct)) {
    const key = normalizedName(p.name);
    if (key) {
      const since = new Date(Date.now() - 365 * 86_400_000);
      const rows = await tx.prospect.findMany({ where: { organizationId: org, productId: p.productId ?? null, phone: null, email: null, createdAt: { gte: since }, status: { notIn: ["DISMISSED"] } }, orderBy: { createdAt: "asc" }, include: { product: { select: { name: true } } }, take: 2000 });
      for (const r of rows) {
        if (normalizedName(r.name) !== key) continue;
        const near = r.lat !== null && r.lng !== null && p.lat != null && p.lng != null ? metresBetween({ lat: Number(r.lat), lng: Number(r.lng) }, { lat: p.lat, lng: p.lng }) <= SAME_PLACE_METRES : (r.lat === null || p.lat == null);
        if (near) out.push({ kind: "PROSPECT", id: r.id, name: r.name, productId: r.productId, productName: r.product?.name ?? null, createdAt: r.createdAt, sameProduct: true, mine: mine(r), status: r.status, by: "place" });
      }
    }
  }
  return out;
}

// ---------- recording a visit ----------
export type VisitInput = {
  clientRef?: string; // the phone's own id for this visit; a retry with the same id returns the saved visit instead of a second one
  prospectId?: string; // an explicit revisit of a known prospect
  productId?: string; // only a manager may choose; an agent's product comes from their profile
  name?: string; ownerName?: string; phone?: string; country?: string; email?: string; address?: string; city?: string;
  outcome?: string; reason?: string; note?: string; followUpOn?: string;
  visitedAt?: string | Date; lat?: number | string | null; lng?: number | string | null; accuracyM?: number | string | null;
  differentBusiness?: boolean; // the agent says the nearby same-name prospect is another branch
};
export type VisitResult = { visitId: string; prospectId: string; prospectName: string; created: boolean; revisit: boolean; needsDetails: boolean; replayed: boolean; outcome: VisitOutcome; alsoProspectFor: string[]; status: string; demoBookingId: string | null };

const num = (v: unknown): number | null => { if (v === null || v === undefined || String(v).trim() === "") return null; const n = Number(v); return Number.isFinite(n) ? n : null; };

export async function recordVisit(db: Db, actor: Actor, input: VisitInput, now = new Date()): Promise<VisitResult> {
  if (!actor.permissions.has("field.capture")) throw new ProspectorError("You do not have permission to log field visits.");
  const org = actor.organizationId;
  const profile = await agentProfile(db, org, actor.id);
  const manager = canReview(actor);
  if (!manager && profile.kind !== "FIELD") throw new ProspectorError("Your profile is set to office work. Ask your sales manager to mark you as a field agent.");
  let productId = profile.productId;
  if (manager && input.productId) {
    const prod = await db.saasProduct.findFirst({ where: { id: input.productId, organizationId: org }, select: { id: true } });
    if (!prod) throw new ProspectorError("Choose one of the listed products.", "productId");
    productId = prod.id;
  }
  if (!productId) throw new ProspectorError("You are not on a product yet. Ask your sales manager to put you on one (Agentify ERP, Velocity ERP or Pharmivo).");
  const product = await db.saasProduct.findUniqueOrThrow({ where: { id: productId }, select: { id: true, name: true, active: true } });
  if (!product.active) throw new ProspectorError(`${product.name} is switched off. Ask your sales manager.`);

  // A retry of a visit the phone already sent (offline queue): give back the saved one, do not save it twice
  const clientRef = clean(input.clientRef, 64) || null;
  if (clientRef) {
    const seen = await db.prospectVisit.findUnique({ where: { organizationId_agentId_clientRef: { organizationId: org, agentId: actor.id, clientRef } }, include: { prospect: { select: { name: true, status: true, phone: true, email: true } } } });
    if (seen) return { visitId: seen.id, prospectId: seen.prospectId, prospectName: seen.prospect.name, created: false, revisit: false, needsDetails: !seen.prospect.phone && !seen.prospect.email, replayed: true, outcome: seen.outcome as VisitOutcome, alsoProspectFor: [], status: seen.prospect.status, demoBookingId: null };
  }

  if (!(VISIT_OUTCOMES as readonly string[]).includes(String(input.outcome))) throw new ProspectorError("Choose what happened at the visit.", "outcome");
  const outcome = input.outcome as VisitOutcome;
  const policy = await getPolicy(db, org);
  const picked = clean(input.country, 2).toUpperCase();
  const country = isCountry(picked) ? picked : policy.defaultCountry;
  const rawPhone = clean(input.phone, 40);
  const phone = rawPhone ? normalizeE164(rawPhone, country) : null;
  if (rawPhone && !phone) throw new ProspectorError(phoneProblem(rawPhone, country) ?? "That phone number does not look right.", "phone");
  const rawEmail = clean(input.email, 200);
  const email = rawEmail ? normalizeEmail(rawEmail) : null;
  if (rawEmail && !email) throw new ProspectorError("That email address does not look right. Use the form name@company.com.", "email");
  const name = clean(input.name, 160);
  const ownerName = clean(input.ownerName, 120) || null;
  const address = clean(input.address, 300) || null;
  const city = clean(input.city, 80) || null;
  const reason = cleanNote(input.reason, 500) || null;
  const note = cleanNote(input.note, 1000) || null;
  const followUpOn = clean(input.followUpOn, 10) || null;
  if (followUpOn && !/^\d{4}-\d{2}-\d{2}$/.test(followUpOn)) throw new ProspectorError("Enter the follow-up date as a date.", "followUpOn");

  // When: the phone's time, but never in the future and never older than a month (an offline queue, not an archive)
  let visitedAt = input.visitedAt ? new Date(input.visitedAt) : now;
  if (Number.isNaN(visitedAt.getTime())) visitedAt = now;
  if (visitedAt.getTime() > now.getTime() + 60_000) visitedAt = now;
  if (now.getTime() - visitedAt.getTime() > MAX_VISIT_AGE_DAYS * 86_400_000) throw new ProspectorError(`This visit is more than ${MAX_VISIT_AGE_DAYS} days old, so it cannot be logged now. Tell your manager about it.`, "visitedAt");

  // Where: both coordinates, in range, or nothing. Accuracy is kept as the phone gave it so managers can see poor fixes.
  let lat = num(input.lat), lng = num(input.lng);
  const accuracyM = num(input.accuracyM);
  if (lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) { lat = null; lng = null; }
  const locationSource = lat !== null ? "GPS" : "NONE";

  const result = await db.$transaction(async (tx) => {
    for (const k of [phone && `P:${phone}`, email && `E:${email}`].filter(Boolean).sort() as string[]) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`prospect-key:${org}:${k}`}, 0))`;
    }
    if ((phone || email) && (await isSuppressed(tx as unknown as Db, org, { phone, email }))) {
      throw new ProspectorError("This phone number or email is on the do-not-contact list, so the business cannot be added.", phone ? "phone" : "email");
    }

    let target: { id: string; name: string; status: string; phone: string | null; email: string | null; productId: string | null; assignedToId: string | null; addedById: string | null } | null = null;
    const alsoProspectFor: string[] = [];

    if (input.prospectId) {
      const row = await tx.prospect.findFirst({ where: { id: input.prospectId, organizationId: org }, select: { id: true, name: true, status: true, phone: true, email: true, productId: true, assignedToId: true, addedById: true } });
      if (!row) throw new ProspectorError("That prospect no longer exists.");
      if ((row.productId ?? null) !== productId) throw new ProspectorError("This prospect belongs to a different product.");
      if (!manager && row.assignedToId !== actor.id && row.addedById !== actor.id) throw new ProspectorError("This prospect belongs to another team member. Ask a sales manager if it should be reassigned.");
      target = row;
    } else {
      const matches = await findMatches(tx, actor, { phone, email, productId, name, lat, lng });
      // This very business already became a lead from a prospect of this product: say so plainly, before the generic lead message
      const converted = matches.find((m) => m.kind === "PROSPECT" && m.sameProduct && m.status === "SENT_TO_CRM");
      if (converted) throw new ProspectorError(`${converted.name} is already a lead. Log the visit as an activity on the lead instead.`, phone ? "phone" : "email");
      const client = matches.find((m) => m.kind === "CLIENT");
      if (client) throw new ProspectorError(describeMatch(client, product.name), phone ? "phone" : "email");
      const lead = matches.find((m) => m.kind === "LEAD");
      if (lead) throw new ProspectorError(describeMatch(lead, product.name), phone ? "phone" : "email");
      for (const m of matches) {
        if (m.kind !== "PROSPECT") continue;
        if (!m.sameProduct) { if (m.productName && !alsoProspectFor.includes(m.productName)) alsoProspectFor.push(m.productName); continue; }
        if (m.by === "place" && input.differentBusiness) continue;
        if (m.mine || manager) {
          // The agent's own prospect: this is another visit to it, not a new business
          const row = await tx.prospect.findUniqueOrThrow({ where: { id: m.id }, select: { id: true, name: true, status: true, phone: true, email: true, productId: true, assignedToId: true, addedById: true } });
          if (!manager || !target) target = row;
          continue;
        }
        if (m.status === "DISMISSED") throw new ProspectorError(`${m.name} was added before and dismissed. Ask a sales manager to restore it.`, phone ? "phone" : email ? "email" : "name");
        throw new ProspectorError(describeMatch(m, product.name), m.by === "place" ? "name" : phone ? "phone" : "email");
      }
      if (!target && !name) throw new ProspectorError("Enter the business's name.", "name");
    }

    if (target && CLOSED_FOR_VISITS.includes(target.status)) {
      throw new ProspectorError(target.status === "SENT_TO_CRM" ? `${target.name} is already a lead. Log the visit as an activity on the lead instead.` : `${target.name} was dismissed. Ask a sales manager to restore it first.`);
    }

    // Status from the outcome. A business that said no is closed; interested or demo requested is "contacted" and stays a prospect until the demo is booked;
    // a closed shop or absent owner leaves the prospect assigned to the agent for a revisit. Going back to a Not interested shop that changed its mind reopens it.
    const nextStatus = outcome === "NOT_INTERESTED" ? "NOT_INTERESTED" : outcome === "INTERESTED" || outcome === "DEMO_REQUESTED" ? "CONTACTED" : target ? (target.status === "NOT_INTERESTED" ? "NOT_INTERESTED" : target.status === "CONTACTED" ? "CONTACTED" : "ASSIGNED") : "ASSIGNED";
    const fill = { contactName: ownerName ?? undefined, address: address ?? undefined, city: city ?? undefined, lat: lat ?? undefined, lng: lng ?? undefined, lastVisitAt: visitedAt, lastOutcome: outcome };

    let prospectId: string, prospectName: string, created = false;
    if (target) {
      // Details learned on this visit fill what was empty; a number or email that is new is checked like any other
      const data: Prisma.ProspectUpdateInput = { ...fill, status: nextStatus, assignedToId: target.assignedToId ?? actor.id, assignedAt: target.assignedToId ? undefined : visitedAt };
      if (!target.phone && phone) data.phone = phone;
      if (!target.email && email) data.email = email;
      if (name && name !== target.name && !target.phone && !target.email) data.name = name; // a shop logged without details may have had its name read wrong
      if (note) { const old = (await tx.prospect.findUnique({ where: { id: target.id }, select: { notes: true } }))?.notes; data.notes = [old, `${fmtDate(visitedAt)}: ${note}`].filter(Boolean).join("\n").slice(0, 4000); }
      const upd = await tx.prospect.update({ where: { id: target.id }, data, select: { id: true, name: true } });
      prospectId = upd.id; prospectName = upd.name;
    } else {
      const row = await tx.prospect.create({
        data: {
          organizationId: org, searchId: null, placeId: `visit:${randomUUID()}`, origin: "MANUAL", sourceLabel: FIELD_SOURCE, captureKind: "FIELD", productId,
          name, phone, email, country, contactName: ownerName, address, city, lat, lng, lastVisitAt: visitedAt, lastOutcome: outcome,
          notes: note ? `${fmtDate(visitedAt)}: ${note}` : null, addedById: actor.id, status: nextStatus, assignedToId: actor.id, assignedAt: visitedAt, placeFetchedAt: visitedAt, createdAt: visitedAt,
        },
        select: { id: true, name: true },
      });
      prospectId = row.id; prospectName = row.name; created = true;
    }

    const visit = await tx.prospectVisit.create({
      data: { organizationId: org, prospectId, productId, agentId: actor.id, visitedAt, lat, lng, accuracyM: accuracyM !== null ? Math.max(0, Math.round(accuracyM)) : null, locationSource, outcome, reason, note, followUpOn, clientRef },
      select: { id: true },
    });
    // The CRM's contact history (shown when the prospect becomes a lead) gets the visits that were a real conversation
    if (outcome === "NOT_INTERESTED" || outcome === "INTERESTED" || outcome === "DEMO_REQUESTED") {
      await tx.prospectOutreach.create({ data: { organizationId: org, prospectId, userId: actor.id, outcome: outcome === "NOT_INTERESTED" ? "NOT_INTERESTED" : "CONTACTED", note: [`Field visit: ${VISIT_OUTCOME_LABEL[outcome]}`, reason, note].filter(Boolean).join(". ").slice(0, 1000), createdAt: visitedAt } });
    }
    // Demo requested: one open request per business for the onboarding team (decision 73). Asking again adds to the note instead of a second row.
    let demoBookingId: string | null = null;
    if (outcome === "DEMO_REQUESTED") {
      const preferred = [reason, followUpOn ? `Go back on ${followUpOn}` : null, note].filter(Boolean).join(". ").slice(0, 1000) || null;
      const open = await tx.demoBooking.findFirst({ where: { prospectId, status: { in: ["REQUESTED", "SCHEDULED"] } }, select: { id: true, status: true, preferredNote: true } });
      if (open) {
        if (open.status === "REQUESTED") await tx.demoBooking.update({ where: { id: open.id }, data: { preferredNote: [open.preferredNote, preferred ? `${fmtDate(visitedAt)}: ${preferred}` : null].filter(Boolean).join("\n").slice(0, 2000) || null, visitId: visit.id } });
        demoBookingId = open.id;
      } else {
        demoBookingId = (await tx.demoBooking.create({ data: { organizationId: org, prospectId, productId, requestedById: actor.id, requestedAt: visitedAt, visitId: visit.id, preferredNote: preferred }, select: { id: true } })).id;
      }
    }
    const after = await tx.prospect.findUniqueOrThrow({ where: { id: prospectId }, select: { phone: true, email: true, status: true } });
    return { visitId: visit.id, prospectId, prospectName, created, revisit: !created, needsDetails: !after.phone && !after.email, replayed: false, outcome, alsoProspectFor, status: after.status, demoBookingId } satisfies VisitResult;
  }).catch((e: unknown) => {
    // Two phones sent the same clientRef at the same moment: the unique index decides, and the loser reads the winner
    if (clientRef && typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002") return null;
    throw e;
  });
  if (!result) return recordVisit(db, actor, { clientRef: clientRef! }, now);
  if (result.created) await rescoreProspects(db, org, [result.prospectId], now);
  if (result.demoBookingId) {
    // the onboarding team hears about it once per request; a second ask at the same shop does not ring again
    const team = await usersWithPermission(db, org, "prospector.schedule_demo", actor.id);
    for (const userId of team) await notify(db, userId, { kind: "demo.requested", title: `${result.prospectName} asked for a demo`, body: `Field visit by ${(await db.user.findUnique({ where: { id: actor.id }, select: { name: true } }))?.name ?? "an agent"}. Book a time in the demo queue.`, link: "/leads/prospector/demos", dedupeKey: `demo-request:${result.demoBookingId}:${userId}` });
  }
  return result;
}

// ---------- the day's count ----------
// Visits count once per business per day, whatever the outcome; a closed shop visited twice the same day is one visit.
export async function visitsToday(db: Db, organizationId: string, userId: string, opts: { now?: Date; tzOffsetMinutes?: number } = {}) {
  const now = opts.now ?? new Date();
  const start = dayStart(now, opts.tzOffsetMinutes ?? 0);
  const [rows, profile] = await Promise.all([
    db.prospectVisit.findMany({ where: { organizationId, agentId: userId, visitedAt: { gte: start, lt: new Date(start.getTime() + 86_400_000) } }, select: { prospectId: true, outcome: true } }),
    agentProfile(db, organizationId, userId),
  ]);
  const businesses = new Set(rows.map((r) => r.prospectId));
  const outcomes: Record<string, number> = {};
  for (const r of rows) outcomes[r.outcome] = (outcomes[r.outcome] ?? 0) + 1;
  return { count: businesses.size, target: profile.dailyVisitTarget, outcomes, product: profile.productName };
}

// Prospects the agent should go back to: last visit found the shop closed, the owner out, or nobody available, and no visit since
export const revisitWhere = (actor: Actor): Prisma.ProspectWhereInput => ({
  organizationId: actor.organizationId, assignedToId: actor.id, status: { in: ["ASSIGNED", "CONTACTED"] }, lastOutcome: { in: [...REVISIT_OUTCOMES] },
});

export { isManager };

// ---------- photos ----------
// Up to 6 per visit: one visiting card and the premises (storefront, hoarding, display board, inside). Each goes through the file service
// (type sniffed, size cap, virus scan when configured) under owner PROSPECT_VISIT, so the access rule follows the visit. A photo the phone
// sends twice (a retried upload) is recognised by its hash and not stored again.
export const PHOTO_CATEGORIES = ["VISITING_CARD", "PREMISES"] as const;
export type PhotoCategory = (typeof PHOTO_CATEGORIES)[number];
export const PHOTO_LABEL: Record<PhotoCategory, string> = { VISITING_CARD: "Visiting card", PREMISES: "Premises" };

export async function attachVisitPhotos(
  db: Db, storage: import("./storage").StorageProvider, actor: import("./file-access").FileActor,
  visitId: string, photos: { name: string; bytes: Buffer; category: string }[],
): Promise<{ saved: number; skipped: number; errors: string[] }> {
  const { createHash } = await import("node:crypto");
  const { saveFile, FileError } = await import("./files");
  const existing = await db.storedFile.findMany({ where: { organizationId: actor.organizationId, ownerType: "PROSPECT_VISIT", ownerId: visitId, deletedAt: null }, select: { sha256: true } });
  const seen = new Set(existing.map((f) => f.sha256));
  let room = MAX_PHOTOS_PER_VISIT - existing.length;
  let saved = 0, skipped = 0;
  const errors: string[] = [];
  for (const p of photos) {
    const category = (PHOTO_CATEGORIES as readonly string[]).includes(p.category) ? p.category : "PREMISES";
    const hash = createHash("sha256").update(p.bytes).digest("hex");
    if (seen.has(hash)) { skipped++; continue; }
    if (room <= 0) { errors.push(`Only ${MAX_PHOTOS_PER_VISIT} photos are kept per visit; the rest were left out.`); break; }
    try {
      await saveFile(db, storage, { actor, ownerType: "PROSPECT_VISIT", ownerId: visitId, name: p.name || `${category.toLowerCase()}.jpg`, bytes: p.bytes, category });
      seen.add(hash); room--; saved++;
    } catch (e) {
      if (e instanceof FileError) errors.push(e.message); else throw e;
    }
  }
  return { saved, skipped, errors };
}

// ---------- the agent's own screen ----------
// What the field screen needs on load: the agent's product and target, today's count, prospects to go back to, and today's visits.
export async function fieldHome(db: Db, actor: Actor, opts: { now?: Date; tzOffsetMinutes?: number } = {}) {
  const now = opts.now ?? new Date();
  const org = actor.organizationId;
  const [profile, today, revisits] = await Promise.all([
    agentProfile(db, org, actor.id),
    visitsToday(db, org, actor.id, opts),
    db.prospect.findMany({ where: revisitWhere(actor), orderBy: { lastVisitAt: "desc" }, take: 50, select: { id: true, name: true, phone: true, address: true, lastVisitAt: true, lastOutcome: true, contactName: true } }),
  ]);
  const start = dayStart(now, opts.tzOffsetMinutes ?? 0);
  const visits = await db.prospectVisit.findMany({
    where: { organizationId: org, agentId: actor.id, visitedAt: { gte: start } }, orderBy: { visitedAt: "desc" }, take: 100,
    select: { id: true, visitedAt: true, outcome: true, locationSource: true, prospect: { select: { id: true, name: true, phone: true, email: true, status: true } } },
  });
  const photoCounts = visits.length ? await db.storedFile.groupBy({ by: ["ownerId"], where: { organizationId: org, ownerType: "PROSPECT_VISIT", ownerId: { in: visits.map((v) => v.id) }, deletedAt: null }, _count: { _all: true } }) : [];
  const photos = new Map(photoCounts.map((p) => [p.ownerId, p._count._all]));
  // The demos this agent asked for: waiting for the onboarding team, or booked (then the business is a lead of theirs)
  const demos = await db.demoBooking.findMany({
    where: { organizationId: org, requestedById: actor.id, status: { in: ["REQUESTED", "SCHEDULED"] } }, orderBy: [{ status: "desc" }, { requestedAt: "desc" }], take: 50,
    select: { id: true, status: true, requestedAt: true, scheduledAt: true, mode: true, leadId: true, prospect: { select: { id: true, name: true } } },
  });
  return { profile, today, revisits, demos, visits: visits.map((v) => ({ ...v, photos: photos.get(v.id) ?? 0, needsDetails: !v.prospect.phone && !v.prospect.email })) };
}

// Minutes east of UTC for a named zone at a moment, so "today" is the agent's day, not the server's
export function zoneOffsetMinutes(timeZone: string, at = new Date()): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(at);
    const n = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
    const asUtc = Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second"));
    return Math.round((asUtc - at.getTime()) / 60_000);
  } catch { return 0; }
}
