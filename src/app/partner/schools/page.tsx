import Link from "next/link";
import { requirePartnerUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { COLLECTION_LABEL, addMonths, hifiCollectsMargin, isMonth, monthLabel, monthOf, termFor } from "@/lib/partner-resale";
import { getSettings } from "@/lib/partner-stack";
import { Badge, Empty, Notice, PageHeader } from "@/components/ui";
import SubmitButton from "@/components/ui/SubmitButton";
import { addSchoolAction, enterCountAction } from "./actions";

export const dynamic = "force-dynamic";

type SP = { month?: string; saved?: string; error?: string };
const money = (v: { toString(): string }, cur: string) => `${Number(v.toString()).toLocaleString("en-US", { maximumFractionDigits: 2 })} ${cur}`;

// The reseller's schools and their monthly student counts. Everything is read for the signed-in partner only.
export default async function MySchools({ searchParams }: { searchParams: Promise<SP> }) {
  const { user, earner } = await requirePartnerUser();
  const sp = await searchParams;
  const org = user.organizationId;
  const thisMonth = monthOf(new Date());
  const lastMonth = addMonths(thisMonth, -1);
  const month = sp.month && isMonth(sp.month) && [thisMonth, lastMonth].includes(sp.month) ? sp.month : lastMonth;
  const [terms, schools, settings, margin, solutions] = await Promise.all([
    db.partnerResaleTerm.findMany({ where: { organizationId: org, earnerId: earner.id }, include: { product: { select: { code: true, name: true } } } }),
    db.resaleSchool.findMany({ where: { organizationId: org, earnerId: earner.id }, include: { client: { select: { name: true } }, product: { select: { name: true } }, counts: { where: { month: { in: [lastMonth, thisMonth] } } } }, orderBy: [{ endedAt: { sort: "asc", nulls: "first" } }, { createdAt: "asc" }], take: 500 }),
    getSettings(db, org),
    hifiCollectsMargin(db, org, earner.id),
    db.earnerSolution.findMany({ where: { earnerId: earner.id }, include: { product: { select: { id: true, code: true, name: true } } } }),
  ]);
  const resale = solutions.filter((s) => terms.some((t) => t.productId === s.productId && t.model === "RESALE"));
  const monthStart = new Date(`${month}-01T00:00:00+05:00`);
  const shown = schools.filter((s) => s.startMonth <= month && (!s.endedAt || s.endedAt >= monthStart));
  if (resale.length === 0 && schools.length === 0) {
    return (
      <div className="space-y-5">
        <PageHeader title="My schools" />
        <Empty title="Resale is not set up for you yet">When Hifi agrees resale prices with you, your Solutions appear here and you can add the schools you sell to. Ask your partner manager.</Empty>
      </div>
    );
  }
  return (
    <div className="space-y-5">
      <PageHeader title="My schools" subtitle={`Enter each school's student count for the month. Hifi confirms the counts and bills on day ${settings.resale_billing_day} of the next month.`} />
      {sp.saved && <Notice kind="ok">{sp.saved}</Notice>}
      {sp.error && <Notice kind="error">{sp.error}</Notice>}
      <section className="card space-y-2">
        <h2 className="font-semibold">Your prices</h2>
        <ul className="space-y-1 text-sm">
          {resale.map((s) => {
            const t = termFor(terms.filter((x) => x.productId === s.productId), thisMonth) ?? terms.filter((x) => x.productId === s.productId).sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : 1))[0];
            if (!t || t.model !== "RESALE") return <li key={s.productId}>{s.product.name}: commission</li>;
            return <li key={s.productId}><strong>{s.product.name}</strong>: {COLLECTION_LABEL[t.collection]} · Hifi&rsquo;s price {money(t.wholesalePrice, t.currency)} per {t.unitName}{t.resalePrice && <>, your price to schools {money(t.resalePrice, t.currency)}</>}{t.effectiveFrom > thisMonth && ` (from ${monthLabel(t.effectiveFrom)})`}</li>;
          })}
        </ul>
        {margin.length > 0 && (
          <p className="text-sm">Your margin on schools Hifi bills: {margin.map((m) => `${money(m.earned, m.currency)} earned from paid invoices, ${money(m.waiting, m.currency)} waiting for schools to pay`).join("; ")}. Hifi pays your margin to your payout account.</p>
        )}
      </section>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Month">
        {[lastMonth, thisMonth].map((m) => <Link key={m} href={`/partner/schools?month=${m}`} className={m === month ? "btn" : "btn-ghost"} aria-current={m === month ? "page" : undefined}>{monthLabel(m)}</Link>)}
      </div>
      {shown.length === 0 ? <Empty title={`No schools for ${monthLabel(month)}`}>Add a school below.</Empty> : (
        <div className="card !p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left"><th className="px-4 py-2.5">School</th><th className="pr-4">Solution</th><th className="pr-4">Students</th><th className="pr-4">Status</th></tr></thead>
            <tbody className="divide-y divide-border">
              {shown.map((s) => {
                const c = s.counts.find((x) => x.month === month);
                return (
                  <tr key={s.id}>
                    <td className="px-4 py-2.5">{s.client.name}</td>
                    <td className="pr-4">{s.product.name}</td>
                    <td className="pr-4">
                      {c?.invoiceId || c?.confirmedAt ? c.units : (
                        <form action={enterCountAction} className="flex items-center gap-1">
                          <input type="hidden" name="month" value={month} /><input type="hidden" name="schoolId" value={s.id} />
                          <label className="sr-only" htmlFor={`n-${s.id}`}>Students at {s.client.name}</label>
                          <input id={`n-${s.id}`} name="units" inputMode="numeric" required defaultValue={c ? String(c.units) : ""} className="input w-20" />
                          <SubmitButton className="btn-ghost text-xs">Save</SubmitButton>
                        </form>
                      )}
                    </td>
                    <td className="pr-4 whitespace-nowrap">{c?.invoiceId ? <Badge>Billed</Badge> : c?.confirmedAt ? <Badge tone="success">Confirmed by Hifi</Badge> : c ? <Badge tone="warning">Waiting for Hifi</Badge> : <Badge tone="warning">Not entered</Badge>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-muted">Once Hifi confirms a count it is locked. To correct it, contact your partner manager.</p>
      {resale.length > 0 && (
        <section className="card space-y-3">
          <h2 className="font-semibold">Add a school</h2>
          <form action={addSchoolAction} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div><label className="label" htmlFor="as-sol">Solution</label><select id="as-sol" name="productCode" className="input">{resale.map((s) => <option key={s.productId} value={s.product.code}>{s.product.name}</option>)}</select></div>
              <div><label className="label" htmlFor="as-name">School name</label><input id="as-name" name="name" required minLength={3} maxLength={160} className="input" /></div>
              <div><label className="label" htmlFor="as-email">School email (optional)</label><input id="as-email" name="email" type="email" maxLength={200} className="input" /></div>
              <div><label className="label" htmlFor="as-phone">School phone (optional)</label><input id="as-phone" name="phone" maxLength={40} className="input" /></div>
              <div><label className="label" htmlFor="as-city">City (optional)</label><input id="as-city" name="city" maxLength={120} className="input" /></div>
              <div><label className="label" htmlFor="as-start">First month to bill</label><input id="as-start" name="startMonth" type="month" required min={lastMonth} defaultValue={thisMonth} className="input" /></div>
            </div>
            <SubmitButton>Add school</SubmitButton>
          </form>
        </section>
      )}
    </div>
  );
}
