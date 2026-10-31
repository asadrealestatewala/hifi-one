import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { audit, requirePermission } from "@/lib/auth";
import { createDraftInvoice, LedgerError } from "@/lib/accounting";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { Chips, Empty, ExportLink, NewButton, Notice, PageHeader, Pager, SearchBox, SortTh, Stat, StatusBadge } from "@/components/ui";
import { orderFor } from "@/lib/sort";
import { listHref } from "@/lib/list-params";
import { INVOICE_SORTS, INVOICE_STATUSES, invoiceOutstanding, invoiceParams, invoiceWhere } from "@/lib/lists";
import SavedViews from "@/components/SavedViews";
import { loadViews } from "@/lib/saved-views";
import Drawer from "@/components/ui/Drawer";
import InvoiceForm from "./InvoiceForm";

export const dynamic = "force-dynamic";

const num = z.string().regex(/^\d{1,10}(\.\d{1,2})?$/);

async function createInvoice(formData: FormData) {
  "use server";
  const user = await requirePermission("finance.post");
  const fail = (m: string) => redirect(`/finance/invoices?new=1&error=${encodeURIComponent(m)}`);
  const clientId = String(formData.get("clientId") ?? "");
  const currency = z.enum(["PKR", "USD", "AED", "GBP"]).safeParse(formData.get("currency"));
  const taxRate = z.string().regex(/^\d{1,3}(\.\d{1,2})?$/).safeParse(formData.get("taxRate") || "0");
  if (!clientId || !currency.success || !taxRate.success) return fail("Choose a client, a currency and a valid tax rate.");
  const lines: { description: string; quantity: string; unitPrice: string }[] = [];
  for (let i = 0; i < 20; i++) {
    const description = String(formData.get(`desc${i}`) ?? "").trim();
    const quantity = String(formData.get(`qty${i}`) ?? "").trim();
    const unitPrice = String(formData.get(`price${i}`) ?? "").trim();
    if (!description && !quantity && !unitPrice) continue;
    if (!description || !num.safeParse(quantity).success || !num.safeParse(unitPrice).success) {
      return fail(`Line ${i + 1}: enter a description, a quantity and a unit price.`);
    }
    lines.push({ description, quantity, unitPrice });
  }
  let id: string;
  try {
    const inv = await createDraftInvoice(db, {
      organizationId: user.organizationId, clientId, currency: currency.data, taxRate: taxRate.data,
      notes: String(formData.get("notes") ?? "").trim() || null, createdById: user.id, lines,
    });
    id = inv.id;
    await audit(user, { action: "invoice.create_draft", entity: "Invoice", entityId: inv.id, after: { total: inv.total.toString(), currency } });
  } catch (e) {
    if (e instanceof LedgerError) return fail(e.message);
    throw e;
  }
  redirect(`/finance/invoices/${id}`);
}

type SP = { error?: string; status?: string; q?: string; new?: string; page?: string; sort?: string; dir?: string; viewError?: string };

export default async function Invoices({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePermission("finance.view");
  const sp = await searchParams;
  const org = user.organizationId;
  const canPost = user.permissions.has("finance.post");
  const lp = invoiceParams(sp);
  const status = lp.status ?? "all";
  const q = lp.q;
  const where = invoiceWhere(user, lp);
  const pg = lp.page;
  const sort = lp.sort;
  const views = await loadViews(db, user.id, "invoices");
  // Counts and the outstanding figure come from aggregates over every invoice; only the shown page is loaded
  const [invoices, matched, counts, owed, clients, rates] = await Promise.all([
    db.invoice.findMany({ where, orderBy: orderFor(sort, INVOICE_SORTS), skip: pg.skip, take: pg.take, include: { client: true } }),
    db.invoice.count({ where }),
    db.invoice.groupBy({ by: ["status"], where: { organizationId: org }, _count: true }),
    invoiceOutstanding(db, user),
    sp.new && canPost ? db.client.findMany({ where: { organizationId: org, active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, currency: true } }) : Promise.resolve([]),
    sp.new && canPost ? db.taxRate.findMany({ where: { organizationId: org, active: true }, orderBy: { name: "asc" } }) : Promise.resolve([]),
  ]);
  const count = new Map(counts.map((c) => [c.status as string, c._count]));
  const total = counts.reduce((s, c) => s + c._count, 0);
  const current = { status: lp.status, q, sort: lp.sortChosen ? sort.key : undefined, dir: lp.sortChosen ? sort.dir : undefined };
  const href = (over: Record<string, string | undefined>) => listHref("/finance/invoices", current, over);

  return (
    <div className="space-y-5">
      <PageHeader title="Invoices" subtitle="Draft, issue and track what clients owe." actions={<><ExportLink href={listHref("/finance/invoices/export", current)} />{canPost && <NewButton href={href({ new: "1" })}>New invoice</NewButton>}</>} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="All invoices" value={total} />
        <Stat label="Drafts" value={count.get("DRAFT") ?? 0} hint="not yet posted" />
        <Stat label="Overdue" value={count.get("OVERDUE") ?? 0} />
        <Stat label="Outstanding" value={owed.size === 0 ? "None" : [...owed].map(([c, v]) => formatMoney(v, c)).join(" · ")} hint="per currency" />
      </div>
      {sp.error && !sp.new && <Notice kind="error">{sp.error}</Notice>}
      <div className="flex flex-wrap items-center gap-3">
        <SearchBox q={q} placeholder="Search number or client" hidden={{ status: status === "all" ? undefined : status }} />
        <Chips current={status} items={[{ key: "all", label: "All", count: total, href: href({ status: undefined }) }, ...INVOICE_STATUSES.map((s) => ({ key: s, label: s.toLowerCase().replace("_", " ").replace(/^./, (c) => c.toUpperCase()), count: count.get(s) ?? 0, href: href({ status: s }) }))]} />
      </div>
      <SavedViews list="invoices" views={views} current={current} error={sp.viewError} />
      {invoices.length === 0 ? <Empty title={q || status !== "all" ? "No invoices match" : "No invoices yet"}>{canPost ? "Create the first one with New invoice." : "Invoices will appear here."}</Empty> : (
        <div className="card overflow-x-auto !p-0">
          <table className="w-full text-sm">
            <thead className="bg-hover/60 text-left text-xs text-muted">
              <tr><SortTh label="Number" field="number" sort={sort} hrefFor={href} className="px-4 py-2.5" /><th className="pr-4">Client</th><th className="pr-4">Status</th><SortTh label="Due" field="due" sort={sort} hrefFor={href} /><SortTh label="Total" field="total" sort={sort} hrefFor={href} className="pr-4 text-right" /><th className="pr-4 text-right">Outstanding</th></tr>
            </thead>
            <tbody>
              {invoices.map((i) => (
                <tr key={i.id} className="border-t border-border transition hover:bg-hover/50">
                  <td className="px-4 py-3"><Link className="font-medium hover:underline" href={`/finance/invoices/${i.id}`}>{i.number ?? "Draft"}</Link></td>
                  <td className="pr-4">{i.client.name}</td>
                  <td className="pr-4"><StatusBadge status={i.status} /></td>
                  <td className="pr-4 text-muted">{i.dueDate ? i.dueDate.toISOString().slice(0, 10) : ""}</td>
                  <td className="pr-4 text-right tabular-nums">{formatMoney(i.total, i.currency)}</td>
                  <td className="pr-4 text-right tabular-nums">{i.status === "DRAFT" || i.status === "CANCELLED" ? "" : formatMoney(i.total.sub(i.amountPaid).sub(i.creditedAmount), i.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pager page={pg.page} size={pg.size} total={matched} href={(n) => href({ page: n > 1 ? String(n) : undefined })} />
        </div>
      )}
      {canPost && sp.new && (
        <Drawer title="New invoice" closeTo={href({ new: undefined, error: undefined })}>
          <InvoiceForm action={createInvoice} clients={clients} taxPresets={rates.map((r) => ({ name: r.name, rate: r.ratePercent.toString() }))} closeTo={href({ new: undefined })} error={sp.error} />
        </Drawer>
      )}
    </div>
  );
}
