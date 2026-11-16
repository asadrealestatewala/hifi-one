// Reseller partners, step 2: resale terms per Solution, the schools a reseller sells to, monthly unit counts, monthly draft
// invoices, and partners telling Hifi they paid. Free of Next.js imports so it can be tested against the database.
//
// Rules (docs/PARTNER_STACK.md, "Reseller partners, step 2"):
// - A partner earns on a Solution either by commission (default) or by resale. Resale has one of two collection models, chosen
//   per partner and Solution: PARTNER_COLLECTS (the partner bills the schools; Hifi invoices the partner wholesale price x units)
//   or HIFI_COLLECTS (Hifi invoices each school at the partner's resale price; the partner's margin is paid out to them later).
// - Terms are never edited once a month was billed with them; a change applies from a month that has not been billed.
// - Schools are Hifi Clients linked to the partner, so they stay Hifi's clients if the partnership ends.
// - Only confirmed counts are billed. Invoices are DRAFTS for Finance to review and issue: nothing is posted here. Issuing,
//   receipts and reversals go through accounting.ts (postJournal). A partner's "I've paid" never marks money received.
import { Prisma, type PrismaClient } from "@prisma/client";
import { computeInvoiceTotals, round2 } from "./ledger-math";
import { recordPayment } from "./accounting";
import { appUrl, firstName, sendTemplateQuietly } from "./email-template-store";
import type { FileActor } from "./file-access";
import { FileError, saveFile } from "./files";
import { notifyMany, usersWithPermission } from "./notifications";
import { getSettings, partnerId } from "./partner-stack";
import type { StorageProvider } from "./storage";

type Db = PrismaClient;
type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];
const D = Prisma.Decimal;

export class ResaleError extends Error { constructor(message: string, readonly field?: string) { super(message); } }

export const COLLECTIONS = [["PARTNER_COLLECTS", "Partner collects"], ["HIFI_COLLECTS", "Hifi collects"]] as const;
export const COLLECTION_LABEL: Record<string, string> = Object.fromEntries(COLLECTIONS);
export const COLLECTION_HELP: Record<string, string> = {
  PARTNER_COLLECTS: "The partner bills the schools at their own price. Hifi sends the partner one monthly invoice at the wholesale price.",
  HIFI_COLLECTS: "Hifi bills each school at the partner's resale price. The partner's margin is paid to them from what schools actually paid.",
};

// ----- Months (company time, Pakistan) -----

export const isMonth = (m: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(m);
export function monthOf(d: Date): string {
  const k = new Date(d.getTime() + 5 * 3600000); // Asia/Karachi, no daylight saving
  return `${k.getUTCFullYear()}-${String(k.getUTCMonth() + 1).padStart(2, "0")}`;
}
export function addMonths(m: string, n: number): string {
  const [y, mo] = m.split("-").map(Number);
  const t = y * 12 + (mo - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}
export const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
const dayOfMonth = (d: Date) => new Date(d.getTime() + 5 * 3600000).getUTCDate();

// The term that applies to a month: the latest one that starts on or before it.
export function termFor<T extends { effectiveFrom: string }>(terms: T[], month: string): T | null {
  return terms.filter((t) => t.effectiveFrom <= month).sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1))[0] ?? null;
}

const money = (v: string, field: string, label: string) => {
  const t = v.trim().replace(/,/g, "");
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(t)) throw new ResaleError(`Enter the ${label} as an amount, for example 20 or 20.50.`, field);
  return round2(t);
};

// ----- Terms -----

export type TermInput = {
  model: string; collection: string; unitName: string; currency: string; wholesalePrice: string; resalePrice: string; paymentTermsDays: string; effectiveFrom: string; note?: string;
};

async function solutionOf(db: Db | Tx, organizationId: string, earnerId: string, productCode: string) {
  const earner = await db.earner.findFirst({ where: { id: earnerId, organizationId }, include: { solutions: { include: { product: true } } } });
  if (!earner) throw new ResaleError("Partner not found.");
  const sol = earner.solutions.find((s) => s.product.code === productCode);
  if (!sol) throw new ResaleError("This partner is not approved to sell that Solution. Tick it under their terms first.", "productCode");
  return { earner, product: sol.product };
}

async function billedMonths(db: Db | Tx, earnerId: string, productId: string) {
  const rows = await db.resaleCount.findMany({ where: { invoiceId: { not: null }, school: { earnerId, productId } }, select: { month: true }, distinct: ["month"] });
  return new Set(rows.map((r) => r.month));
}

export async function setResaleTerm(db: Db, p: { organizationId: string; earnerId: string; productCode: string; actorId: string; input: TermInput; now?: Date }) {
  const now = p.now ?? new Date();
  const { earner, product } = await solutionOf(db, p.organizationId, p.earnerId, p.productCode);
  const i = p.input;
  if (!["COMMISSION", "RESALE"].includes(i.model)) throw new ResaleError("Choose Commission or Resale.", "model");
  const from = i.effectiveFrom.trim();
  if (!isMonth(from)) throw new ResaleError("Choose the month the terms start.", "effectiveFrom");
  if (from < monthOf(now)) throw new ResaleError("Terms can start this month or later, never in a past month.", "effectiveFrom");
  const billed = await billedMonths(db, earner.id, product.id);
  if ([...billed].some((m) => m >= from)) throw new ResaleError(`${monthLabel([...billed].sort().pop()!)} is already billed. Start the new terms after it.`, "effectiveFrom");
  let data: Omit<Prisma.PartnerResaleTermUncheckedCreateInput, "organizationId" | "earnerId" | "productId" | "effectiveFrom" | "createdById">;
  if (i.model === "COMMISSION") {
    data = { model: "COMMISSION", collection: "PARTNER_COLLECTS", unitName: "student", currency: "PKR", wholesalePrice: new D(0), resalePrice: null, paymentTermsDays: 10, note: i.note?.trim().slice(0, 300) || null };
  } else {
    // Agreed plan: the identity check is needed before resale billing (not before training)
    const id = await db.partnerIdentity.findUnique({ where: { earnerId: earner.id }, select: { status: true } });
    if (id?.status !== "VERIFIED") throw new ResaleError("Verify this partner's identity first (Identity check below). Resale billing needs it; training does not.", "model");
    if (!COLLECTION_LABEL[i.collection]) throw new ResaleError("Choose who collects from the schools.", "collection");
    const unitName = i.unitName.trim().toLowerCase().slice(0, 20);
    if (!/^[a-z][a-z ]{1,19}$/.test(unitName)) throw new ResaleError("Name what is counted, for example student.", "unitName");
    if (!["PKR", "USD", "AED", "GBP"].includes(i.currency)) throw new ResaleError("Choose a currency.", "currency");
    const wholesale = money(i.wholesalePrice, "wholesalePrice", "wholesale price");
    if (wholesale.lte(0)) throw new ResaleError("The wholesale price must be more than zero.", "wholesalePrice");
    const resale = i.resalePrice.trim() ? money(i.resalePrice, "resalePrice", "resale price") : null;
    if (i.collection === "HIFI_COLLECTS" && !resale) throw new ResaleError("When Hifi collects, enter the partner's price to schools: Hifi bills that price.", "resalePrice");
    if (resale && resale.lt(wholesale)) throw new ResaleError("The resale price cannot be lower than the wholesale price.", "resalePrice");
    const days = Number(i.paymentTermsDays);
    if (!Number.isInteger(days) || days < 0 || days > 90) throw new ResaleError("Payment terms: 0 to 90 days.", "paymentTermsDays");
    data = { model: "RESALE", collection: i.collection, unitName, currency: i.currency, wholesalePrice: wholesale, resalePrice: resale, paymentTermsDays: days, note: i.note?.trim().slice(0, 300) || null };
  }
  return db.$transaction(async (tx) => {
    const row = await tx.partnerResaleTerm.upsert({
      where: { earnerId_productId_effectiveFrom: { earnerId: earner.id, productId: product.id, effectiveFrom: from } },
      create: { organizationId: p.organizationId, earnerId: earner.id, productId: product.id, effectiveFrom: from, createdById: p.actorId, ...data },
      update: { ...data, createdById: p.actorId, createdAt: now }, // same month, nothing billed yet: a correction
    });
    if (row.model === "RESALE" && row.collection === "PARTNER_COLLECTS") await ensureBillingClient(tx, p.organizationId, earner.id, row.currency, row.paymentTermsDays);
    if (row.model === "RESALE" && row.collection === "HIFI_COLLECTS") {
      await tx.client.updateMany({ where: { resaleSchools: { some: { earnerId: earner.id, productId: product.id, endedAt: null } } }, data: { paymentTermsDays: row.paymentTermsDays } });
    }
    return row;
  });
}

async function nextClientCode(tx: Tx, organizationId: string) {
  const seq = await tx.numberSequence.upsert({
    where: { organizationId_key: { organizationId, key: "CLIENT" } },
    create: { organizationId, key: "CLIENT", next: 2 },
    update: { next: { increment: 1 } },
  });
  return `C-${String(seq.next - 1).padStart(4, "0")}`;
}

// The Client record Hifi invoices the partner through. Named with the Partner ID so it never collides with a real client.
async function ensureBillingClient(tx: Tx, organizationId: string, earnerId: string, currency: string, termsDays: number) {
  const e = await tx.earner.findUniqueOrThrow({ where: { id: earnerId }, include: { identity: { select: { businessName: true, legalName: true, address: true, ntn: true, status: true } } } });
  if (e.billingClientId) {
    await tx.client.update({ where: { id: e.billingClientId }, data: { paymentTermsDays: termsDays } });
    return e.billingClientId;
  }
  const who = e.identity?.status === "VERIFIED" ? (e.identity.businessName ?? e.identity.legalName) : e.name;
  const c = await tx.client.create({
    data: {
      organizationId, code: await nextClientCode(tx, organizationId), name: `${who} (${partnerId(e.partnerNumber)})`, email: e.email, phone: e.phone, country: e.country,
      billingAddress: e.identity?.status === "VERIFIED" ? e.identity.address : null, taxId: e.identity?.status === "VERIFIED" ? e.identity.ntn : null, currency, paymentTermsDays: termsDays, clientType: "SAAS",
    },
  });
  await tx.earner.update({ where: { id: e.id }, data: { billingClientId: c.id } });
  return c.id;
}

export async function termsByProduct(db: Db, organizationId: string, earnerId: string) {
  const rows = await db.partnerResaleTerm.findMany({ where: { organizationId, earnerId }, include: { product: { select: { code: true, name: true } } }, orderBy: { effectiveFrom: "asc" } });
  const by = new Map<string, typeof rows>();
  for (const r of rows) by.set(r.productId, [...(by.get(r.productId) ?? []), r]);
  return by;
}

// ----- Schools -----

export type SchoolInput = { productCode: string; name: string; email?: string; phone?: string; city?: string; startMonth: string };

export async function addSchool(db: Db, p: { organizationId: string; earnerId: string; actorId: string; byStaff: boolean; input: SchoolInput; now?: Date }) {
  const now = p.now ?? new Date();
  const { earner, product } = await solutionOf(db, p.organizationId, p.earnerId, p.input.productCode);
  const term = termFor(await db.partnerResaleTerm.findMany({ where: { earnerId: earner.id, productId: product.id } }), addMonths(monthOf(now), 1));
  const anyResale = await db.partnerResaleTerm.findFirst({ where: { earnerId: earner.id, productId: product.id, model: "RESALE" } });
  if (!anyResale) throw new ResaleError(`${product.name} is not set up for resale for this partner yet.`, "productCode");
  const name = p.input.name.replace(/\s+/g, " ").trim().slice(0, 160);
  if (name.length < 3) throw new ResaleError("Enter the school's name.", "name");
  const start = p.input.startMonth.trim();
  if (!isMonth(start) || start < addMonths(monthOf(now), -1)) throw new ResaleError("Choose the first month to bill (last month at the earliest).", "startMonth");
  const email = p.input.email?.trim().toLowerCase().slice(0, 200) || null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ResaleError("Enter a valid email address or leave it empty.", "email");
  return db.$transaction(async (tx) => {
    let client = await tx.client.findFirst({ where: { organizationId: p.organizationId, name: { equals: name, mode: "insensitive" } } });
    if (client) {
      const linked = await tx.resaleSchool.findFirst({ where: { clientId: client.id, productId: product.id, endedAt: null } });
      if (linked) throw new ResaleError(linked.earnerId === earner.id ? "This school is already on your list." : "This school is already served through another partner. Ask Hifi.", "name");
      // A partner never attaches an existing Hifi client to themselves; only staff can, after checking it is the same school
      if (!p.byStaff) throw new ResaleError("A client with this name already exists at Hifi. Ask the partner team to link it for you.", "name");
    } else {
      client = await tx.client.create({
        data: {
          organizationId: p.organizationId, code: await nextClientCode(tx, p.organizationId), name, email, phone: p.input.phone?.trim().slice(0, 40) || null,
          billingAddress: p.input.city?.trim().slice(0, 120) || null, country: earner.country, currency: term?.currency ?? anyResale.currency, paymentTermsDays: term?.paymentTermsDays ?? anyResale.paymentTermsDays, clientType: "SAAS",
        },
      });
    }
    return tx.resaleSchool.create({ data: { organizationId: p.organizationId, earnerId: earner.id, productId: product.id, clientId: client.id, startMonth: start, addedById: p.actorId } });
  });
}

export async function endSchool(db: Db, p: { organizationId: string; earnerId: string; schoolId: string; actorId: string; now?: Date }) {
  const s = await db.resaleSchool.findFirst({ where: { id: p.schoolId, earnerId: p.earnerId, organizationId: p.organizationId, endedAt: null } });
  if (!s) throw new ResaleError("School not found.");
  return db.resaleSchool.update({ where: { id: s.id }, data: { endedAt: p.now ?? new Date(), endedById: p.actorId } });
}

// ----- Counts -----

export async function enterCount(db: Db, p: { organizationId: string; earnerId: string; schoolId: string; month: string; units: string; actorId: string; byStaff: boolean; now?: Date }) {
  const now = p.now ?? new Date();
  const s = await db.resaleSchool.findFirst({ where: { id: p.schoolId, earnerId: p.earnerId, organizationId: p.organizationId }, include: { client: { select: { name: true } } } });
  if (!s) throw new ResaleError("School not found.");
  if (!isMonth(p.month)) throw new ResaleError("Choose a month.");
  if (p.month < s.startMonth) throw new ResaleError(`Billing for this school starts in ${monthLabel(s.startMonth)}.`);
  if (p.month > monthOf(now)) throw new ResaleError("Counts can be entered for this month or earlier, not for a future month.");
  if (s.endedAt && p.month > monthOf(s.endedAt)) throw new ResaleError("This school was removed before that month.");
  const t = p.units.trim().replace(/,/g, "");
  if (!/^\d{1,6}$/.test(t)) throw new ResaleError("Enter the number of students as a whole number.", "units");
  const units = Number(t);
  const existing = await db.resaleCount.findUnique({ where: { schoolId_month: { schoolId: s.id, month: p.month } } });
  if (existing?.invoiceId) throw new ResaleError(`${monthLabel(p.month)} is already billed for ${s.client.name}. Ask Hifi if it needs a correction.`);
  if (!p.byStaff && existing?.confirmedAt) throw new ResaleError(`Hifi already confirmed ${monthLabel(p.month)} for ${s.client.name}. Ask your partner manager to correct it.`);
  const confirm = p.byStaff ? { confirmedById: p.actorId, confirmedAt: now } : { confirmedById: null, confirmedAt: null };
  const row = await db.resaleCount.upsert({
    where: { schoolId_month: { schoolId: s.id, month: p.month } },
    create: { organizationId: p.organizationId, schoolId: s.id, month: p.month, units, enteredById: p.actorId, enteredAt: now, ...confirm },
    update: { units, enteredById: p.actorId, enteredAt: now, ...confirm },
  });
  if (!p.byStaff) {
    const e = await db.earner.findUniqueOrThrow({ where: { id: p.earnerId }, select: { name: true } });
    await notifyMany(db, await usersWithPermission(db, p.organizationId, "partners.manage"), {
      kind: "partner.resale_count", title: `Student counts to confirm: ${e.name}`, body: `${monthLabel(p.month)}`, link: `/partner-stack/resale?month=${p.month}`, dedupeKey: `resale-count:${p.earnerId}:${p.month}:${now.toISOString().slice(0, 10)}`,
    });
  }
  return { before: existing, after: row };
}

export async function confirmCounts(db: Db, p: { organizationId: string; countIds: string[]; actorId: string; now?: Date }) {
  const r = await db.resaleCount.updateMany({ where: { id: { in: p.countIds }, organizationId: p.organizationId, invoiceId: null, confirmedAt: null }, data: { confirmedById: p.actorId, confirmedAt: p.now ?? new Date() } });
  return r.count;
}

// ----- Monthly draft invoices -----

export type BillingResult = { invoices: number; partnerInvoices: number; schoolInvoices: number; unconfirmed: number; missing: string[] };

export async function createResaleDrafts(db: Db, p: { organizationId: string; month: string; actorId: string | null; now?: Date }): Promise<BillingResult> {
  if (!isMonth(p.month)) throw new ResaleError("Choose a month.");
  const now = p.now ?? new Date();
  if (p.month >= monthOf(now)) throw new ResaleError("A month is billed once it has ended.");
  const schools = await db.resaleSchool.findMany({
    where: { organizationId: p.organizationId, startMonth: { lte: p.month } },
    include: { client: true, product: true, earner: true, counts: { where: { month: p.month } } },
    orderBy: [{ earnerId: "asc" }, { createdAt: "asc" }],
  });
  const terms = await db.partnerResaleTerm.findMany({ where: { organizationId: p.organizationId } });
  const res: BillingResult = { invoices: 0, partnerInvoices: 0, schoolInvoices: 0, unconfirmed: 0, missing: [] };
  const toPartner = new Map<string, { earner: (typeof schools)[number]["earner"]; currency: string; rows: { count: (typeof schools)[number]["counts"][number]; school: (typeof schools)[number]; term: (typeof terms)[number] }[] }>();
  for (const s of schools) {
    if (s.endedAt && monthOf(s.endedAt) < p.month) continue;
    const term = termFor(terms.filter((t) => t.earnerId === s.earnerId && t.productId === s.productId), p.month);
    if (!term || term.model !== "RESALE") continue;
    const c = s.counts[0];
    if (!c) { res.missing.push(`${s.client.name} (${s.earner.name})`); continue; }
    if (c.invoiceId) continue; // already billed
    if (!c.confirmedAt) { res.unconfirmed++; continue; }
    if (c.units === 0) {
      await db.resaleCount.update({ where: { id: c.id }, data: { invoiceId: "NONE", collection: term.collection, wholesalePrice: term.wholesalePrice, resalePrice: term.resalePrice } });
      continue;
    }
    if (term.collection === "HIFI_COLLECTS") {
      await db.$transaction(async (tx) => {
        const fresh = await tx.resaleCount.findUniqueOrThrow({ where: { id: c.id } });
        if (fresh.invoiceId) return;
        const t = computeInvoiceTotals([{ quantity: c.units, unitPrice: term.resalePrice! }], 0);
        const inv = await tx.invoice.create({
          data: {
            organizationId: p.organizationId, clientId: s.clientId, currency: term.currency, taxRate: 0, subtotal: t.subtotal, taxAmount: t.taxAmount, total: t.total, createdById: p.actorId,
            notes: `${s.product.name} for ${monthLabel(p.month)}, through Hifi partner ${s.earner.name} (${partnerId(s.earner.partnerNumber)}).`, // printed on the invoice the school receives
            lines: { create: [{ description: `${s.product.name}: ${monthLabel(p.month)}, ${c.units} ${term.unitName}${c.units === 1 ? "" : "s"}`, quantity: c.units, unitPrice: term.resalePrice!, amount: t.amounts[0] }] },
          },
        });
        await tx.resaleCount.update({ where: { id: c.id }, data: { invoiceId: inv.id, collection: term.collection, wholesalePrice: term.wholesalePrice, resalePrice: term.resalePrice } });
        res.invoices++; res.schoolInvoices++;
      });
    } else {
      const key = `${s.earnerId}:${term.currency}`;
      const g = toPartner.get(key) ?? { earner: s.earner, currency: term.currency, rows: [] };
      g.rows.push({ count: c, school: s, term });
      toPartner.set(key, g);
    }
  }
  for (const g of toPartner.values()) {
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"resale-bill:" + g.earner.id + ":" + p.month}))`;
      const fresh = await tx.resaleCount.findMany({ where: { id: { in: g.rows.map((r) => r.count.id) }, invoiceId: null } });
      const rows = g.rows.filter((r) => fresh.some((f) => f.id === r.count.id));
      if (rows.length === 0) return;
      const clientId = await ensureBillingClient(tx, p.organizationId, g.earner.id, g.currency, rows[0].term.paymentTermsDays);
      const lines = rows.map((r) => ({ description: `${r.school.product.name}: ${r.school.client.name}, ${monthLabel(p.month)}, ${r.count.units} ${r.term.unitName}${r.count.units === 1 ? "" : "s"}`, quantity: r.count.units, unitPrice: r.term.wholesalePrice }));
      const t = computeInvoiceTotals(lines, 0);
      const inv = await tx.invoice.create({
        data: {
          organizationId: p.organizationId, clientId, currency: g.currency, taxRate: 0, subtotal: t.subtotal, taxAmount: t.taxAmount, total: t.total, createdById: p.actorId,
          notes: `Partner resale for ${monthLabel(p.month)}, ${partnerId(g.earner.partnerNumber)}: wholesale price per school from the confirmed counts.`, // printed on the partner's invoice
          lines: { create: lines.map((l, i) => ({ description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, amount: t.amounts[i] })) },
        },
      });
      for (const r of rows) await tx.resaleCount.update({ where: { id: r.count.id }, data: { invoiceId: inv.id, collection: r.term.collection, wholesalePrice: r.term.wholesalePrice, resalePrice: r.term.resalePrice } });
      res.invoices++; res.partnerInvoices++;
    });
  }
  return res;
}

// What the partner has earned on schools Hifi collects from: margin on invoices fully paid, and margin waiting on unpaid ones.
export async function hifiCollectsMargin(db: Db, organizationId: string, earnerId: string) {
  const counts = await db.resaleCount.findMany({ where: { organizationId, collection: "HIFI_COLLECTS", invoiceId: { not: null }, school: { earnerId } } });
  const ids = counts.map((c) => c.invoiceId!).filter((id) => id !== "NONE");
  const invoices = await db.invoice.findMany({ where: { id: { in: ids } }, select: { id: true, status: true, currency: true } });
  const out = new Map<string, { earned: Prisma.Decimal; waiting: Prisma.Decimal }>();
  for (const c of counts) {
    const inv = invoices.find((i) => i.id === c.invoiceId);
    if (!inv || inv.status === "CANCELLED" || inv.status === "DRAFT") continue;
    const m = (c.resalePrice ?? new D(0)).sub(c.wholesalePrice ?? new D(0)).mul(c.units);
    const cur = out.get(inv.currency) ?? { earned: new D(0), waiting: new D(0) };
    if (inv.status === "PAID") cur.earned = cur.earned.add(m); else cur.waiting = cur.waiting.add(m);
    out.set(inv.currency, cur);
  }
  return [...out.entries()].map(([currency, v]) => ({ currency, earned: v.earned, waiting: v.waiting }));
}

// ----- "I've paid" -----

export const RECEIPT_MAX_BYTES = 5 * 1024 * 1024;

export async function submitPaymentNotice(db: Db, storage: StorageProvider, p: { actor: FileActor; earnerId: string; invoiceId: string; amount: string; paidOn: string; reference: string; file: { name: string; bytes: Buffer } | null; now?: Date }) {
  const now = p.now ?? new Date();
  const earner = await db.earner.findFirst({ where: { id: p.earnerId, organizationId: p.actor.organizationId } });
  if (!earner?.billingClientId) throw new ResaleError("Invoice not found.");
  const inv = await db.invoice.findFirst({ where: { id: p.invoiceId, organizationId: p.actor.organizationId, clientId: earner.billingClientId, status: { in: ["ISSUED", "PARTIALLY_PAID"] } } });
  if (!inv) throw new ResaleError("This invoice is not open for payment.");
  const owed = inv.total.sub(inv.amountPaid).sub(inv.creditedAmount);
  const amount = money(p.amount, "amount", "amount you paid");
  if (amount.lte(0) || amount.gt(owed)) throw new ResaleError(`Enter the amount you paid, up to ${owed.toFixed(2)} ${inv.currency}.`, "amount");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.paidOn)) throw new ResaleError("Enter the date you paid.", "paidOn");
  const paidOn = new Date(`${p.paidOn}T00:00:00Z`);
  if (paidOn.getTime() > now.getTime() + 86400000) throw new ResaleError("The payment date cannot be in the future.", "paidOn");
  const reference = p.reference.trim().slice(0, 80);
  if (reference.length < 3) throw new ResaleError("Enter the transfer reference or transaction ID from your bank or wallet.", "reference");
  if (!p.file || p.file.bytes.length === 0) throw new ResaleError("Attach the receipt or a screenshot of the transfer.", "file");
  const ext = p.file.name.toLowerCase().split(".").pop() ?? "";
  if (!["jpg", "jpeg", "png", "pdf"].includes(ext)) throw new FileError("Attach the receipt as a JPG, PNG or PDF.");
  if (await db.partnerPaymentNotice.findFirst({ where: { invoiceId: inv.id, status: "PENDING" } })) throw new ResaleError("You already told us about a payment for this invoice. We will confirm it shortly.");
  const notice = await db.partnerPaymentNotice.create({
    data: { organizationId: inv.organizationId, earnerId: earner.id, invoiceId: inv.id, amount, currency: inv.currency, paidOn, reference, createdById: p.actor.id, createdAt: now },
  });
  try {
    await saveFile(db, storage, { actor: p.actor, ownerType: "PARTNER_PAYMENT_NOTICE", ownerId: notice.id, name: p.file.name, bytes: p.file.bytes, maxBytes: RECEIPT_MAX_BYTES, category: "RECEIPT" });
  } catch (e) {
    await db.partnerPaymentNotice.delete({ where: { id: notice.id } });
    throw e;
  }
  await notifyMany(db, await usersWithPermission(db, inv.organizationId, "finance.post"), {
    kind: "partner.payment_notice", title: `Partner payment to confirm: ${earner.name}`, body: `${inv.number}: ${amount.toFixed(2)} ${inv.currency}, ref ${reference}`, link: "/finance/partner-payments", dedupeKey: `partner-notice:${notice.id}`,
  });
  return notice;
}

export async function confirmPaymentNotice(db: Db, p: { organizationId: string; noticeId: string; actorId: string; bankAccountId: string }) {
  const n = await db.partnerPaymentNotice.findFirst({ where: { id: p.noticeId, organizationId: p.organizationId }, include: { earner: true } });
  if (!n) throw new ResaleError("Payment not found.");
  if (n.status !== "PENDING") throw new ResaleError("This payment was already handled.");
  const inv = await db.invoice.findUniqueOrThrow({ where: { id: n.invoiceId } });
  const bank = await db.bankAccount.findFirst({ where: { id: p.bankAccountId, organizationId: p.organizationId, active: true } });
  if (!bank) throw new ResaleError("Choose the bank account the money arrived in.", "bankAccountId");
  if (bank.currency !== n.currency) throw new ResaleError(`That account is in ${bank.currency}; this payment is in ${n.currency}.`, "bankAccountId");
  // The receipt goes through the normal flow (journal, allocation, receipt number); the key makes a double click post once
  const payment = await recordPayment(db, {
    organizationId: p.organizationId, actorId: p.actorId, clientId: inv.clientId, bankAccountId: bank.id, amount: n.amount.toString(), date: n.paidOn,
    method: "BANK_TRANSFER", reference: n.reference, idempotencyKey: `partner-notice:${n.id}`, invoiceIds: [inv.id],
  });
  const done = await db.partnerPaymentNotice.updateMany({ where: { id: n.id, status: "PENDING" }, data: { status: "CONFIRMED", reviewedById: p.actorId, reviewedAt: new Date(), paymentId: payment.id } });
  if (done.count === 1) {
    await sendTemplateQuietly(db, {
      organizationId: p.organizationId, key: "partner_payment_result", to: n.earner.email, relatedType: "Earner", relatedId: n.earnerId,
      vars: { first_name: firstName(n.earner.name), result: "received", invoice: inv.number ?? "", amount: `${n.amount.toFixed(2)} ${n.currency}`, note: `Thank you. We received your payment and receipt ${payment.number} is on your invoice.`, link: `${appUrl()}/partner/invoices` },
    });
  }
  return { notice: n, payment };
}

export async function rejectPaymentNotice(db: Db, p: { organizationId: string; noticeId: string; actorId: string; reason: string }) {
  const reason = p.reason.trim().slice(0, 600);
  if (reason.length < 5) throw new ResaleError("Say why, so the partner can correct it.", "reason");
  const n = await db.partnerPaymentNotice.findFirst({ where: { id: p.noticeId, organizationId: p.organizationId }, include: { earner: true } });
  if (!n) throw new ResaleError("Payment not found.");
  const done = await db.partnerPaymentNotice.updateMany({ where: { id: n.id, status: "PENDING" }, data: { status: "REJECTED", reviewNote: reason, reviewedById: p.actorId, reviewedAt: new Date() } });
  if (done.count === 0) throw new ResaleError("This payment was already handled.");
  const inv = await db.invoice.findUniqueOrThrow({ where: { id: n.invoiceId }, select: { number: true } });
  await sendTemplateQuietly(db, {
    organizationId: p.organizationId, key: "partner_payment_result", to: n.earner.email, relatedType: "Earner", relatedId: n.earnerId,
    vars: { first_name: firstName(n.earner.name), result: "not found yet", invoice: inv.number ?? "", amount: `${n.amount.toFixed(2)} ${n.currency}`, note: `We could not match this payment yet: ${reason}`, link: `${appUrl()}/partner/invoices` },
  });
  return n;
}

// ----- Daily job -----

async function once(db: Db, userId: string, key: string, title: string): Promise<boolean> {
  try {
    await db.notification.create({ data: { userId, kind: "partner.resale", title, dedupeKey: key } });
    return true;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return false;
    throw e;
  }
}

// 1st of the month: ask resellers for last month's counts. Billing day (setting, default 5th): make the drafts for last month.
// Every day: a warning to the partner 7 days after an invoice is due, and an alert to staff at 15 days to pause the schools.
export async function runResaleDaily(db: Db, organizationId: string, now = new Date()) {
  const out: string[] = [];
  const last = addMonths(monthOf(now), -1);
  const day = dayOfMonth(now);
  const settings = await getSettings(db, organizationId);
  const billingDay = Math.min(28, Math.max(2, Number(settings.resale_billing_day) || 5));
  const pauseDays = Math.min(90, Math.max(1, Number(settings.resale_pause_days) || 15));
  if (day === 1) {
    const partners = await db.earner.findMany({ where: { organizationId, status: "ACTIVE", resaleSchools: { some: { endedAt: null, startMonth: { lte: last } } } }, select: { id: true, name: true, email: true, userId: true } });
    let n = 0;
    for (const e of partners) {
      if (e.userId && !(await once(db, e.userId, `resale-counts:${e.id}:${last}`, `Enter your student counts for ${monthLabel(last)}`))) continue;
      await sendTemplateQuietly(db, { organizationId, key: "partner_counts_due", to: e.email, relatedType: "Earner", relatedId: e.id, vars: { first_name: firstName(e.name), month: monthLabel(last), billing_day: String(billingDay), link: `${appUrl()}/partner/schools` } });
      n++;
    }
    out.push(`${n} count reminder${n === 1 ? "" : "s"}`);
  }
  if (day === billingDay) {
    const r = await createResaleDrafts(db, { organizationId, month: last, actorId: null, now });
    out.push(`${r.invoices} draft invoice${r.invoices === 1 ? "" : "s"} for ${monthLabel(last)}`);
    if (r.invoices > 0) await notifyMany(db, await usersWithPermission(db, organizationId, "finance.post"), { kind: "partner.resale_drafts", title: `${r.invoices} partner resale invoice${r.invoices === 1 ? "" : "s"} to review`, body: `${monthLabel(last)}: drafts made from confirmed counts`, link: "/finance/invoices?status=DRAFT", dedupeKey: `resale-drafts:${organizationId}:${last}` });
    if (r.unconfirmed || r.missing.length) await notifyMany(db, await usersWithPermission(db, organizationId, "partners.manage"), { kind: "partner.resale_counts", title: `${monthLabel(last)}: ${r.unconfirmed} count${r.unconfirmed === 1 ? "" : "s"} to confirm, ${r.missing.length} missing`, body: r.missing.slice(0, 5).join(", "), link: `/partner-stack/resale?month=${last}`, dedupeKey: `resale-open:${organizationId}:${last}` });
  }
  const billing = await db.earner.findMany({ where: { organizationId, billingClientId: { not: null } }, select: { id: true, name: true, email: true, userId: true, partnerNumber: true, billingClientId: true } });
  let warned = 0, paused = 0;
  for (const e of billing) {
    const open = await db.invoice.findMany({ where: { clientId: e.billingClientId!, status: { in: ["ISSUED", "PARTIALLY_PAID"] }, dueDate: { not: null } } });
    for (const inv of open) {
      const late = Math.floor((now.getTime() - inv.dueDate!.getTime()) / 86400000);
      if (late >= 7 && e.userId && (await once(db, e.userId, `resale-overdue:${inv.id}`, `Invoice ${inv.number} is overdue`))) {
        await sendTemplateQuietly(db, { organizationId, key: "partner_invoice_overdue", to: e.email, relatedType: "Invoice", relatedId: inv.id, vars: { first_name: firstName(e.name), invoice: inv.number ?? "", amount: `${inv.total.sub(inv.amountPaid).sub(inv.creditedAmount).toFixed(2)} ${inv.currency}`, days: String(late), pause_days: String(pauseDays), link: `${appUrl()}/partner/invoices` } });
        warned++;
      }
      if (late >= pauseDays) {
        const schools = await db.resaleSchool.findMany({ where: { earnerId: e.id, endedAt: null }, include: { client: { select: { name: true } }, product: { select: { name: true } } } });
        await notifyMany(db, [...await usersWithPermission(db, organizationId, "partners.manage"), ...await usersWithPermission(db, organizationId, "finance.post")], {
          kind: "partner.resale_pause", title: `${pauseDays}+ days unpaid: pause ${e.name}'s schools`, body: `${inv.number}. Pause access in ${[...new Set(schools.map((s) => s.product.name))].join(", ") || "the Solution"} for: ${schools.map((s) => s.client.name).join(", ").slice(0, 300)}`,
          link: `/partner-stack/partners?open=${e.id}`, dedupeKey: `resale-pause:${inv.id}`,
        });
        paused++;
      }
    }
  }
  if (warned) out.push(`${warned} overdue warning${warned === 1 ? "" : "s"}`);
  if (paused) out.push(`${paused} pause alert${paused === 1 ? "" : "s"}`);
  return out.join(", ") || "Nothing due today";
}
