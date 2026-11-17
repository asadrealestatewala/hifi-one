import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { COLLECTION_LABEL, addMonths, isMonth, monthLabel, monthOf, termFor } from "@/lib/partner-resale";
import { getSettings, partnerId } from "@/lib/partner-stack";
import { paging } from "@/lib/paging";
import { Badge, Empty, Notice, PageHeader, Pager, Stat } from "@/components/ui";
import ScreenTabs from "@/components/shell/ScreenTabs";
import SubmitButton from "@/components/ui/SubmitButton";
import ConfirmButton from "@/components/ui/ConfirmButton";
import { confirmCountsAction, createDraftsAction, fillCountsAction, staffEnterCountAction } from "../actions";

export const dynamic = "force-dynamic";

type SP = { month?: string; page?: string; saved?: string; error?: string };
const money = (v: { toString(): string }, cur: string) => `${Number(v.toString()).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ${cur}`;

// One month of reseller billing: every school a partner sells to, its student count, and the draft invoices made from them.
export default async function ResaleBilling({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePermission("partners.manage");
  const sp = await searchParams;
  const org = user.organizationId;
  const thisMonth = monthOf(new Date());
  const month = sp.month && isMonth(sp.month) && sp.month <= thisMonth ? sp.month : addMonths(thisMonth, -1);
  const monthStart = new Date(`${month}-01T00:00:00+05:00`);
  const where: Prisma.ResaleSchoolWhereInput = { organizationId: org, startMonth: { lte: month }, OR: [{ endedAt: null }, { endedAt: { gte: monthStart } }] };
  const pg = paging(sp.page);
  const [schools, total, terms, counts, settings] = await Promise.all([
    db.resaleSchool.findMany({ where, include: { client: { select: { id: true, name: true } }, product: { select: { name: true } }, earner: { select: { id: true, name: true, partnerNumber: true } }, counts: { where: { month } } }, orderBy: [{ earner: { partnerNumber: "asc" } }, { createdAt: "asc" }], skip: pg.skip, take: pg.take }),
    db.resaleSchool.count({ where }),
    db.partnerResaleTerm.findMany({ where: { organizationId: org } }),
    db.resaleCount.findMany({ where: { organizationId: org, month, school: where }, select: { id: true, confirmedAt: true, invoiceId: true } }),
    getSettings(db, org),
  ]);
  const invoiceIds = [...new Set(schools.flatMap((s) => s.counts.map((c) => c.invoiceId)).filter((id): id is string => !!id && id !== "NONE"))];
  const invoices = new Map((await db.invoice.findMany({ where: { id: { in: invoiceIds }, organizationId: org }, select: { id: true, number: true, status: true } })).map((i) => [i.id, i]));
  const unconfirmed = counts.filter((c) => !c.confirmedAt && !c.invoiceId);
  const billed = counts.filter((c) => c.invoiceId).length;
  const ended = month < thisMonth;
  const href = (m: string, page?: number) => `/partner-stack/resale?month=${m}${page && page > 1 ? `&page=${page}` : ""}`;
  return (
    <div className="space-y-5">
      <PageHeader tabs={<ScreenTabs group="partner-stack" current="/partner-stack/resale" />} title="Resale billing" subtitle={`Student counts from resellers, confirmed by Hifi, become draft invoices on day ${settings.resale_billing_day} of the next month. Finance reviews and issues them.`} />
      {sp.saved && <Notice kind="ok">{sp.saved}</Notice>}
      {sp.error && <Notice kind="error">{sp.error}</Notice>}
      <div className="flex flex-wrap items-center gap-2">
        <Link className="btn-ghost" href={href(addMonths(month, -1))} aria-label="Previous month">‹</Link>
        <form className="flex items-center gap-2" action="/partner-stack/resale">
          <label className="sr-only" htmlFor="rb-month">Month</label>
          <input id="rb-month" name="month" type="month" max={thisMonth} defaultValue={month} className="input w-auto" />
          <button className="btn-ghost">Show</button>
        </form>
        {month < thisMonth && <Link className="btn-ghost" href={href(addMonths(month, 1))} aria-label="Next month">›</Link>}
        <span className="font-semibold">{monthLabel(month)}</span>
      </div>
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <Stat label="Schools" value={total} />
        <Stat label="Counts entered" value={counts.length} hint={total > counts.length ? `${total - counts.length} missing` : undefined} />
        <Stat label="Waiting for confirmation" value={unconfirmed.length} />
        <Stat label="Billed" value={billed} />
      </div>
      {total === 0 ? (
        <Empty title={`No schools billed for ${monthLabel(month)}`}>Set a partner&rsquo;s Solution to resale and add their schools in <Link className="underline" href="/partner-stack/partners">Partners</Link>.</Empty>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {unconfirmed.length > 0 && (
              <form action={confirmCountsAction}>
                <input type="hidden" name="month" value={month} />
                {unconfirmed.map((c) => <input key={c.id} type="hidden" name="countId" value={c.id} />)}
                <SubmitButton>Confirm {unconfirmed.length} count{unconfirmed.length === 1 ? "" : "s"}</SubmitButton>
              </form>
            )}
            <form action={fillCountsAction}>
              <input type="hidden" name="month" value={month} />
              <SubmitButton className="btn-ghost" pendingText="Filling…">Fill from Live Solutions</SubmitButton>
            </form>
            {ended && (
              <form action={createDraftsAction}>
                <input type="hidden" name="month" value={month} />
                <ConfirmButton className="btn" title={`Make draft invoices for ${monthLabel(month)}?`} message="One draft per partner (Partner collects) and one per school (Hifi collects), from confirmed counts only. Counts already billed are skipped. Nothing is posted until Finance issues an invoice." confirmLabel="Make drafts">Make draft invoices now</ConfirmButton>
              </form>
            )}
          </div>
          <div className="card !p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left"><th className="px-4 py-2.5">Partner</th><th className="pr-4">School</th><th className="pr-4">Solution</th><th className="pr-4">Billing</th><th className="pr-4">Count</th><th className="pr-4">Status</th></tr></thead>
              <tbody className="divide-y divide-border">
                {schools.map((s) => {
                  const c = s.counts[0];
                  const term = termFor(terms.filter((t) => t.earnerId === s.earnerId && t.productId === s.productId), month);
                  const inv = c?.invoiceId && c.invoiceId !== "NONE" ? invoices.get(c.invoiceId) : null;
                  const price = term?.model === "RESALE" ? (term.collection === "HIFI_COLLECTS" ? term.resalePrice : term.wholesalePrice) : null;
                  return (
                    <tr key={s.id}>
                      <td className="px-4 py-2.5"><Link className="hover:underline" href={`/partner-stack/partners?open=${s.earner.id}#resale`}>{s.earner.name}</Link><br /><span className="font-mono text-xs text-muted">{partnerId(s.earner.partnerNumber)}</span></td>
                      <td className="pr-4"><Link className="hover:underline" href={`/clients/${s.client.id}`}>{s.client.name}</Link></td>
                      <td className="pr-4">{s.product.name}</td>
                      <td className="pr-4 whitespace-nowrap">{term?.model === "RESALE" ? <>{COLLECTION_LABEL[term.collection]}{price && <span className="block text-xs text-muted">{money(price, term.currency)} per {term.unitName}</span>}</> : <span className="text-muted">Commission (not billed here)</span>}</td>
                      <td className="pr-4">
                        {c?.invoiceId ? <span>{c.units}</span> : (
                          <form action={staffEnterCountAction} className="flex items-center gap-1">
                            <input type="hidden" name="month" value={month} /><input type="hidden" name="earnerId" value={s.earnerId} /><input type="hidden" name="schoolId" value={s.id} />
                            <label className="sr-only" htmlFor={`cnt-${s.id}`}>Count for {s.client.name}</label>
                            <input id={`cnt-${s.id}`} name="units" inputMode="numeric" required defaultValue={c ? String(c.units) : ""} className="input w-20" />
                            <SubmitButton className="btn-ghost text-xs">Save</SubmitButton>
                          </form>
                        )}
                        {c?.reportedUnits != null && (
                          <span className={`block text-xs ${c.units < c.reportedUnits ? "text-warning font-medium" : "text-muted"}`}>
                            {s.product.name} reported {c.reportedUnits}{c.units < c.reportedUnits && ` · ${c.reportedUnits - c.units} fewer entered`}
                          </span>
                        )}
                      </td>
                      <td className="pr-4 whitespace-nowrap">
                        {!c ? <Badge tone="warning">No count</Badge>
                          : c.invoiceId === "NONE" ? <Badge>Nothing to bill</Badge>
                          : inv ? <Link className="underline" href={`/finance/invoices/${inv.id}`}>{inv.number ?? "Draft invoice"}</Link>
                          : c.confirmedAt ? <Badge tone="success">Confirmed</Badge>
                          : <Badge tone="warning">{c.source === "SOLUTION" ? `From ${s.product.name}, to confirm` : "From partner, to confirm"}</Badge>}
                        {inv && <span className="block text-xs text-muted">{inv.status.toLowerCase().replace(/_/g, " ")}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <Pager page={pg.page} size={pg.size} total={total} href={(n) => href(month, n)} />
          </div>
          <p className="text-xs text-muted">Saving a count here confirms it. Counts a partner enters, and counts filled from Live Solutions (on the 1st, on the billing day, or with the button), wait for your confirmation. A count lower than what the Solution reported is shown in amber. A billed month is locked; correct it with a credit note in Finance.</p>
        </>
      )}
    </div>
  );
}
