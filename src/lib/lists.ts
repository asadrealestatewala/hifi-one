// The paged staff lists (invoices, payments, leads, quotes, expenses, audit log): one place that turns the address
// into a filter, so the screen, its figures and its CSV download always cover exactly the same records.
// Every builder checks the permission itself (the page and route also call requirePermission) and scopes to the organization.
import type { Prisma, PrismaClient } from "@prisma/client";
import { csvCell } from "./crm-contacts";
import { rangeFilter } from "./date-range";
import { leadScope } from "./lead-scope";
import { orderFor } from "./sort";
import { parseListParams, type ListParams, type RawParams } from "./list-params";

export type ListActor = { id: string; organizationId: string; permissions: ReadonlySet<string> };
export class ListAccessError extends Error {}

// Typed text is matched literally: % and _ are not wildcards
const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => "\\" + c);
const ci = (s: string) => ({ contains: s, mode: "insensitive" as const });

export const INVOICE_STATUSES = ["DRAFT", "ISSUED", "PARTIALLY_PAID", "PAID", "OVERDUE", "CANCELLED"] as const;
export const QUOTE_STATUSES = ["DRAFT", "SENT", "ACCEPTED", "DECLINED", "EXPIRED", "INVOICED", "CANCELLED"] as const;
export const EXPENSE_STATUSES = ["SUBMITTED", "UNDER_REVIEW", "APPROVED", "POSTED", "PAID", "REJECTED", "CANCELLED"] as const;

// Sortable columns per list: address key → database field. Nothing else can be sorted on.
export const INVOICE_SORTS = { number: { field: "number", nullable: true }, due: { field: "dueDate", nullable: true }, total: { field: "total" }, created: { field: "createdAt" } };
export const LEAD_SORTS = { name: { field: "name" }, value: { field: "dealValue", nullable: true }, followup: { field: "nextFollowUp", nullable: true }, created: { field: "createdAt" } };

export const LISTS = {
  invoices: { permission: "finance.view", title: "invoices" },
  payments: { permission: "finance.view", title: "payments" },
  leads: { permission: "crm.view", title: "leads" },
  quotes: { permission: "quotes.view", title: "quotes" },
  expenses: { permission: "self.expense", title: "expenses" },
  audit: { permission: "audit.view", title: "audit-log" },
} as const;
export type ListKey = keyof typeof LISTS;

function assertCan(actor: ListActor, key: ListKey) {
  if (!actor.permissions.has(LISTS[key].permission)) throw new ListAccessError(`You do not have permission to see ${LISTS[key].title}.`);
}

export function invoiceParams(sp: RawParams) { return parseListParams(sp, { sorts: Object.keys(INVOICE_SORTS), statuses: INVOICE_STATUSES }); }
export function invoiceWhere(actor: ListActor, p: ListParams): Prisma.InvoiceWhereInput {
  assertCan(actor, "invoices");
  return {
    organizationId: actor.organizationId,
    ...(p.status ? { status: p.status } : {}),
    ...(p.q ? { OR: [{ number: ci(likeEscape(p.q)) }, { client: { name: ci(likeEscape(p.q)) } }] } : {}),
  };
}

export function paymentParams(sp: RawParams) { return parseListParams(sp); }
export function paymentWhere(actor: ListActor, p: ListParams): Prisma.PaymentWhereInput {
  assertCan(actor, "payments");
  const received = rangeFilter(p.range);
  return {
    organizationId: actor.organizationId,
    ...(p.q ? { OR: [{ number: ci(likeEscape(p.q)) }, { client: { name: ci(likeEscape(p.q)) } }, { reference: ci(likeEscape(p.q)) }] } : {}),
    ...(received ? { date: received } : {}),
  };
}

export function leadParams(sp: RawParams) { return parseListParams(sp, { sorts: Object.keys(LEAD_SORTS), ids: ["stage", "campaign", "source"] }); }
export function leadWhere(actor: ListActor, p: ListParams): Prisma.LeadWhereInput {
  assertCan(actor, "leads");
  const created = rangeFilter(p.range);
  return {
    ...leadScope(actor),
    ...(p.ids.stage ? { stageId: p.ids.stage } : {}),
    ...(p.ids.campaign ? { campaignId: p.ids.campaign } : {}),
    ...(p.ids.source ? { leadSourceId: p.ids.source } : {}),
    ...(created ? { createdAt: created } : {}),
    ...(p.q ? { AND: [{ OR: [{ name: ci(likeEscape(p.q)) }, { company: ci(likeEscape(p.q)) }, { email: ci(likeEscape(p.q)) }, { phone: { contains: likeEscape(p.q) } }] }] } : {}),
  };
}

export function quoteParams(sp: RawParams) { return parseListParams(sp, { statuses: QUOTE_STATUSES }); }
export function quoteWhere(actor: ListActor, p: ListParams): Prisma.QuoteWhereInput {
  assertCan(actor, "quotes");
  return {
    organizationId: actor.organizationId,
    ...(p.status ? { status: p.status } : {}),
    ...(p.q ? { OR: [{ number: ci(likeEscape(p.q)) }, { client: { name: ci(likeEscape(p.q)) } }] } : {}),
  };
}

// Expenses: everyone sees their own vouchers; expenses.view sees the whole organization's
export function expenseParams(sp: RawParams) { return parseListParams(sp, { statuses: EXPENSE_STATUSES }); }
export function expenseScope(actor: ListActor): Prisma.ExpenseVoucherWhereInput {
  assertCan(actor, "expenses");
  return { organizationId: actor.organizationId, ...(actor.permissions.has("expenses.view") ? {} : { submittedById: actor.id }) };
}
export function expenseWhere(actor: ListActor, p: ListParams): Prisma.ExpenseVoucherWhereInput {
  return { ...expenseScope(actor), ...(p.status ? { status: p.status } : {}) };
}

export function auditParams(sp: RawParams) { return parseListParams(sp); }
export function auditWhere(actor: ListActor, p: ListParams): Prisma.AuditLogWhereInput {
  assertCan(actor, "audit");
  return {
    organizationId: actor.organizationId,
    ...(p.q ? { OR: [{ action: ci(likeEscape(p.q)) }, { entity: ci(likeEscape(p.q)) }, { actor: { name: ci(likeEscape(p.q)) } }] } : {}),
  };
}

type Dec = Prisma.Decimal;
// What clients still owe on open invoices, per currency (never mixed), from sums over every open invoice
export async function invoiceOutstanding(db: PrismaClient, actor: ListActor): Promise<Map<string, Dec>> {
  assertCan(actor, "invoices");
  const rows = await db.invoice.groupBy({ by: ["currency"], where: { organizationId: actor.organizationId, status: { in: ["ISSUED", "PARTIALLY_PAID", "OVERDUE"] } }, _sum: { total: true, amountPaid: true, creditedAmount: true } });
  const out = new Map<string, Dec>();
  for (const r of rows) if (r._sum.total) out.set(r.currency, r._sum.total.sub(r._sum.amountPaid ?? 0).sub(r._sum.creditedAmount ?? 0));
  return out;
}

// ---------- CSV export ----------

const BATCH = 1000;
const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "");
const money = (d: Dec | null | undefined) => (d == null ? "" : d.toFixed(2));

// Reads every matching row in batches (cursor on id after a stable order), so a large list never sits in memory at once
async function* batches<T extends { id: string }>(fetch: (args: { take: number; skip?: number; cursor?: { id: string } }) => Promise<T[]>): AsyncGenerator<T[]> {
  let cursor: string | undefined;
  for (;;) {
    const rows = await fetch({ take: BATCH, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}) });
    if (rows.length) yield rows;
    if (rows.length < BATCH) return;
    cursor = rows[rows.length - 1].id;
  }
}

export type CsvExport = { filename: string; head: string[]; rows: AsyncGenerator<unknown[][]> };

async function* map<T extends { id: string }>(src: AsyncGenerator<T[]>, f: (rows: T[]) => unknown[][] | Promise<unknown[][]>): AsyncGenerator<unknown[][]> {
  for await (const rows of src) yield await f(rows);
}

// Builds the export for a list with the same filters and order as the screen, and no page cap.
// Throws ListAccessError before reading anything when the person lacks the list's permission.
// Sensitive fields (CNIC, bank details, audit before/after values, IP addresses) are never included.
export function listExport(db: PrismaClient, key: ListKey, actor: ListActor, sp: RawParams): CsvExport {
  assertCan(actor, key);
  const filename = `${LISTS[key].title}-${new Date().toISOString().slice(0, 10)}.csv`;
  switch (key) {
    case "invoices": {
      const p = invoiceParams(sp);
      const where = invoiceWhere(actor, p);
      const orderBy = orderFor(p.sort, INVOICE_SORTS) as Prisma.InvoiceOrderByWithRelationInput[];
      return {
        filename,
        head: ["Number", "Client", "Status", "Issue date", "Due date", "Currency", "Total", "Paid", "Credited", "Outstanding"],
        rows: map(batches((a) => db.invoice.findMany({ where, orderBy, ...a, include: { client: { select: { name: true } } } })), (rows) => rows.map((i) => [
          i.number ?? "Draft", i.client.name, i.status, day(i.issueDate), day(i.dueDate), i.currency, money(i.total), money(i.amountPaid), money(i.creditedAmount),
          i.status === "DRAFT" || i.status === "CANCELLED" ? "" : money(i.total.sub(i.amountPaid).sub(i.creditedAmount)),
        ])),
      };
    }
    case "payments": {
      const where = paymentWhere(actor, paymentParams(sp));
      return {
        filename,
        head: ["Number", "Date", "Client", "Method", "Reference", "Currency", "Amount", "Unallocated", "Invoices"],
        rows: map(batches((a) => db.payment.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], ...a, include: { client: { select: { name: true } }, allocations: { include: { invoice: { select: { number: true } } } } } })), (rows) => rows.map((x) => [
          x.number, day(x.date), x.client.name, x.method, x.reference, x.currency, money(x.amount), money(x.unallocated), x.allocations.map((al) => al.invoice.number).filter(Boolean).join("; "),
        ])),
      };
    }
    case "leads": {
      const p = leadParams(sp);
      const where = leadWhere(actor, p);
      const orderBy = orderFor(p.sort, LEAD_SORTS) as Prisma.LeadOrderByWithRelationInput[];
      return {
        filename,
        head: ["Number", "Name", "Company", "Email", "Phone", "Country", "Stage", "Source", "Priority", "Currency", "Deal value", "Next follow-up", "Created"],
        rows: map(batches((a) => db.lead.findMany({ where, orderBy, ...a, include: { stage: { select: { name: true } } } })), (rows) => rows.map((l) => [
          l.number, l.name, l.company, l.email, l.phone, l.country, l.stage.name, l.source, l.priority, l.currency, money(l.dealValue), day(l.nextFollowUp), day(l.createdAt),
        ])),
      };
    }
    case "quotes": {
      const where = quoteWhere(actor, quoteParams(sp));
      return {
        filename,
        head: ["Number", "Client", "Status", "Created", "Sent", "Currency", "Subtotal", "Tax", "Total"],
        rows: map(batches((a) => db.quote.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], ...a, include: { client: { select: { name: true } } } })), (rows) => rows.map((x) => [
          x.number, x.client.name, x.status, day(x.createdAt), day(x.sentAt), x.currency, money(x.subtotal), money(x.taxAmount), money(x.total),
        ])),
      };
    }
    case "expenses": {
      const where = expenseWhere(actor, expenseParams(sp));
      return {
        filename,
        head: ["Number", "Date", "Submitted by", "Payee", "Description", "Status", "Currency", "Amount"],
        rows: map(batches((a) => db.expenseVoucher.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], ...a })), async (rows) => {
          const people = await db.user.findMany({ where: { organizationId: actor.organizationId, id: { in: [...new Set(rows.map((r) => r.submittedById))] } }, select: { id: true, name: true } });
          const name = new Map(people.map((u) => [u.id, u.name]));
          return rows.map((v) => [v.number, v.date, name.get(v.submittedById) ?? "", v.payee, v.description, v.status, v.currency, money(v.amount)]);
        }),
      };
    }
    case "audit": {
      const where = auditWhere(actor, auditParams(sp));
      return {
        filename,
        head: ["Time (UTC)", "Actor", "Action", "Entity", "Entity ID"],
        rows: map(batches((a) => db.auditLog.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], ...a, select: { id: true, createdAt: true, action: true, entity: true, entityId: true, actor: { select: { name: true } } } })), (rows) => rows.map((x) => [
          x.createdAt.toISOString().replace("T", " ").slice(0, 19), x.actor?.name ?? "System", x.action, x.entity, x.entityId,
        ])),
      };
    }
  }
}

const line = (row: unknown[]) => row.map(csvCell).join(",") + "\r\n";

// The whole export as one string (tests, small lists)
export async function exportCsvText(e: CsvExport): Promise<string> {
  let out = line(e.head);
  for await (const rows of e.rows) for (const r of rows) out += line(r);
  return out;
}

// A streamed CSV download: a byte-order mark so spreadsheet apps read UTF-8, then one batch at a time
export function csvResponse(e: CsvExport): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(c) { c.enqueue(enc.encode("﻿" + line(e.head))); },
    async pull(c) {
      const next = await e.rows.next();
      if (next.done) return c.close();
      c.enqueue(enc.encode(next.value.map(line).join("")));
    },
  });
  return new Response(body, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${e.filename}"`, "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
}
