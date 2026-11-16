// Partner drawer: how the partner earns on each Solution (commission or resale), and the schools they sell to.
// Server markup only; the forms post to the Partner Stack actions.
import Link from "next/link";
import { db } from "@/lib/db";
import { COLLECTIONS, COLLECTION_HELP, COLLECTION_LABEL, addMonths, monthLabel, monthOf, termFor } from "@/lib/partner-resale";
import { Badge } from "@/components/ui";
import SubmitButton from "@/components/ui/SubmitButton";
import ConfirmButton from "@/components/ui/ConfirmButton";
import { setResaleTermAction, staffAddSchoolAction, staffEndSchoolAction } from "../actions";

const CURRENCIES = ["PKR", "USD", "AED", "GBP"];
const amount = (v: { toString(): string } | null) => (v == null ? "" : Number(v.toString()).toLocaleString("en-US", { maximumFractionDigits: 2 }));

export async function ResaleSection({ organizationId, earnerId, solutions }: { organizationId: string; earnerId: string; solutions: { productId: string; product: { code: string; name: string } }[] }) {
  const [terms, schools] = await Promise.all([
    db.partnerResaleTerm.findMany({ where: { organizationId, earnerId }, orderBy: { effectiveFrom: "asc" } }),
    db.resaleSchool.findMany({ where: { organizationId, earnerId }, include: { client: { select: { id: true, name: true, code: true } }, product: { select: { name: true } } }, orderBy: [{ endedAt: { sort: "asc", nulls: "first" } }, { createdAt: "asc" }], take: 200 }),
  ]);
  const thisMonth = monthOf(new Date());
  const resaleCodes = solutions.filter((s) => terms.some((t) => t.productId === s.productId && t.model === "RESALE"));
  return (
    <section id="resale" className="card space-y-4">
      <div>
        <h3 className="font-semibold">Resale terms and schools</h3>
        <p className="text-sm text-muted">Each Solution is sold on commission (the default) or by resale. Resale prices are per student per month unless you name another unit. A change starts from a month that has not been billed; billed months keep their prices.</p>
      </div>
      {solutions.length === 0 ? <p className="text-sm text-muted">Tick the Solutions this partner may sell under Terms first.</p> : (
        <ul className="space-y-3">
          {solutions.map((s) => {
            const mine = terms.filter((t) => t.productId === s.productId);
            const now = termFor(mine, thisMonth);
            const next = mine.filter((t) => t.effectiveFrom > thisMonth);
            const shown = next[next.length - 1] ?? now;
            return (
              <li key={s.productId} className="rounded-lg border border-border p-3 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{s.product.name}</span>
                  {!now || now.model === "COMMISSION" ? <Badge>Commission</Badge> : <Badge tone="primary">Resale · {COLLECTION_LABEL[now.collection]}</Badge>}
                </div>
                {now?.model === "RESALE" && (
                  <p className="text-sm">Wholesale {amount(now.wholesalePrice)} {now.currency} per {now.unitName}{now.resalePrice && <>, partner&rsquo;s price to schools {amount(now.resalePrice)} {now.currency}</>} · pay within {now.paymentTermsDays} days · since {monthLabel(now.effectiveFrom)}</p>
                )}
                {next.map((t) => <p key={t.id} className="text-sm text-muted">From {monthLabel(t.effectiveFrom)}: {t.model === "COMMISSION" ? "commission" : `${COLLECTION_LABEL[t.collection].toLowerCase()}, wholesale ${amount(t.wholesalePrice)} ${t.currency}${t.resalePrice ? `, to schools ${amount(t.resalePrice)} ${t.currency}` : ""}`}</p>)}
                {mine.length > 1 && (
                  <details className="text-xs text-muted"><summary className="cursor-pointer">History ({mine.length})</summary>
                    <ul className="mt-1 space-y-0.5">{mine.map((t) => <li key={t.id}>{monthLabel(t.effectiveFrom)}: {t.model === "COMMISSION" ? "commission" : `${COLLECTION_LABEL[t.collection]}, ${amount(t.wholesalePrice)}${t.resalePrice ? ` / ${amount(t.resalePrice)}` : ""} ${t.currency} per ${t.unitName}`}{t.note && ` · ${t.note}`}</li>)}</ul>
                  </details>
                )}
                <details>
                  <summary className="cursor-pointer text-sm font-medium">{mine.length ? "Change terms" : "Set up resale"}</summary>
                  <form action={setResaleTermAction} className="mt-3 space-y-3">
                    <input type="hidden" name="id" value={earnerId} />
                    <input type="hidden" name="productCode" value={s.product.code} />
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div><label className="label" htmlFor={`rt-model-${s.productId}`}>How they earn</label>
                        <select id={`rt-model-${s.productId}`} name="model" defaultValue={shown?.model ?? "RESALE"} className="input"><option value="RESALE">Resale (they buy from Hifi and sell on)</option><option value="COMMISSION">Commission (Hifi bills the client)</option></select></div>
                      <div><label className="label" htmlFor={`rt-coll-${s.productId}`}>Who bills the schools (resale only)</label>
                        <select id={`rt-coll-${s.productId}`} name="collection" defaultValue={shown?.collection ?? "PARTNER_COLLECTS"} className="input">{COLLECTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
                      <div><label className="label" htmlFor={`rt-unit-${s.productId}`}>Billed per</label>
                        <input id={`rt-unit-${s.productId}`} name="unitName" maxLength={20} defaultValue={shown?.unitName ?? "student"} className="input" /></div>
                      <div><label className="label" htmlFor={`rt-cur-${s.productId}`}>Currency</label>
                        <select id={`rt-cur-${s.productId}`} name="currency" defaultValue={shown?.currency ?? "PKR"} className="input">{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select></div>
                      <div><label className="label" htmlFor={`rt-whole-${s.productId}`}>Wholesale price (what Hifi charges)</label>
                        <input id={`rt-whole-${s.productId}`} name="wholesalePrice" inputMode="decimal" defaultValue={shown?.model === "RESALE" ? String(shown.wholesalePrice) : ""} className="input" /></div>
                      <div><label className="label" htmlFor={`rt-resale-${s.productId}`}>Partner&rsquo;s price to schools</label>
                        <input id={`rt-resale-${s.productId}`} name="resalePrice" inputMode="decimal" defaultValue={shown?.resalePrice ? String(shown.resalePrice) : ""} className="input" placeholder="Needed when Hifi bills the schools" /></div>
                      <div><label className="label" htmlFor={`rt-days-${s.productId}`}>Days to pay an invoice</label>
                        <input id={`rt-days-${s.productId}`} name="paymentTermsDays" type="number" min={0} max={90} defaultValue={shown?.paymentTermsDays ?? 10} className="input" /></div>
                      <div><label className="label" htmlFor={`rt-from-${s.productId}`}>Starts from</label>
                        <input id={`rt-from-${s.productId}`} name="effectiveFrom" type="month" min={thisMonth} required defaultValue={thisMonth} className="input" /></div>
                    </div>
                    <div><label className="label" htmlFor={`rt-note-${s.productId}`}>Note (optional)</label><input id={`rt-note-${s.productId}`} name="note" maxLength={300} className="input" placeholder="For example: agreed on the call of 16 Nov" /></div>
                    <ul className="list-disc pl-5 text-xs text-muted">{COLLECTIONS.map(([v, l]) => <li key={v}><strong>{l}:</strong> {COLLECTION_HELP[v]}</li>)}</ul>
                    <SubmitButton>Save terms</SubmitButton>
                  </form>
                </details>
              </li>
            );
          })}
        </ul>
      )}
      <div className="space-y-2">
        <h4 className="text-sm font-semibold">Schools</h4>
        {schools.length === 0 ? <p className="text-sm text-muted">No schools yet. The partner adds them under My schools in their portal, or you add them here. Each school is a Hifi client, so it stays Hifi&rsquo;s if the partnership ends.</p> : (
          <ul className="divide-y divide-border text-sm">
            {schools.map((x) => (
              <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span><Link className="hover:underline" href={`/clients/${x.client.id}`}>{x.client.name}</Link> <span className="text-muted">· {x.client.code} · {x.product.name} · billed from {monthLabel(x.startMonth)}{x.endedAt && `, removed ${x.endedAt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Karachi" })}`}</span></span>
                {!x.endedAt && (
                  <form action={staffEndSchoolAction}><input type="hidden" name="id" value={earnerId} /><input type="hidden" name="schoolId" value={x.id} />
                    <ConfirmButton reason className="btn-ghost text-xs" title={`Remove ${x.client.name}?`} message="It is not billed after this month. It stays a Hifi client, and months already used are still billed." confirmLabel="Remove">Remove</ConfirmButton></form>
                )}
              </li>
            ))}
          </ul>
        )}
        {resaleCodes.length > 0 && (
          <details>
            <summary className="cursor-pointer text-sm font-medium">Add a school</summary>
            <form action={staffAddSchoolAction} className="mt-3 space-y-3">
              <input type="hidden" name="id" value={earnerId} />
              <div className="grid gap-3 sm:grid-cols-2">
                <div><label className="label" htmlFor="sc-sol">Solution</label><select id="sc-sol" name="productCode" className="input">{resaleCodes.map((s) => <option key={s.productId} value={s.product.code}>{s.product.name}</option>)}</select></div>
                <div><label className="label" htmlFor="sc-name">School name</label><input id="sc-name" name="name" required minLength={3} maxLength={160} className="input" /></div>
                <div><label className="label" htmlFor="sc-email">Email (optional)</label><input id="sc-email" name="email" type="email" maxLength={200} className="input" /></div>
                <div><label className="label" htmlFor="sc-phone">Phone (optional)</label><input id="sc-phone" name="phone" maxLength={40} className="input" /></div>
                <div><label className="label" htmlFor="sc-city">City (optional)</label><input id="sc-city" name="city" maxLength={120} className="input" /></div>
                <div><label className="label" htmlFor="sc-start">First month to bill</label><input id="sc-start" name="startMonth" type="month" required min={addMonths(thisMonth, -1)} defaultValue={thisMonth} className="input" /></div>
              </div>
              <p className="text-xs text-muted">If a Hifi client with this exact name exists, it is linked to this partner. Check it is the same school first.</p>
              <SubmitButton>Add school</SubmitButton>
            </form>
          </details>
        )}
      </div>
    </section>
  );
}
