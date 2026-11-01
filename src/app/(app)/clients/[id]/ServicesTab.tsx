import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { CLIENT_TYPES, CLIENT_TYPE_LABEL, QUOTA_KEYS, QUOTA_LABEL, currentPeriod, quotaSummary } from "@/lib/engagements";
import { Badge, Empty, StatusBadge, SubmitButton } from "@/components/ui";
import { addEngagement, changeEngagementStatus, recordUsage, saveClientProfile, voidUsageEntry } from "./services-actions";

const INTERVAL_LABEL: Record<string, string> = { ONE_TIME: "one time", MONTHLY: "per month", QUARTERLY: "per quarter", ANNUAL: "per year" };

export default async function ServicesTab({ organizationId, client, canEdit }: { organizationId: string; client: { id: string; currency: string; clientType: string; projectManagerId: string | null; supportManagerId: string | null }; canEdit: boolean }) {
  const month = currentPeriod();
  const [engagements, staff, plans] = await Promise.all([
    db.engagement.findMany({ where: { organizationId, clientId: client.id }, orderBy: [{ status: "asc" }, { createdAt: "desc" }], include: { usage: { where: { voided: false }, orderBy: { createdAt: "desc" }, take: 8 } } }),
    canEdit ? db.user.findMany({ where: { organizationId, userType: "EMPLOYEE", active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }) : [],
    canEdit ? db.servicePlan.findMany({ where: { organizationId, active: true, quotas: { some: {} } }, select: { id: true, name: true }, orderBy: { name: "asc" } }) : [],
  ]);
  const quotas = new Map(await Promise.all(engagements.map(async (e) => [e.id, await quotaSummary(db, organizationId, e.id, month)] as const)));
  const pm = client.projectManagerId ? await db.user.findFirst({ where: { id: client.projectManagerId, organizationId }, select: { name: true } }) : null;
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="space-y-5">
      <section className="card space-y-3">
        <h2 className="font-semibold">Client type and project manager</h2>
        {canEdit ? (
          <form action={saveClientProfile} className="grid gap-3 sm:grid-cols-3">
            <input type="hidden" name="clientId" value={client.id} />
            <div><label className="label" htmlFor="clientType">Client type</label><select id="clientType" name="clientType" defaultValue={client.clientType} className="input">{CLIENT_TYPES.map((t) => <option key={t} value={t}>{CLIENT_TYPE_LABEL[t]}</option>)}</select></div>
            <div><label className="label" htmlFor="projectManagerId">Project manager</label><select id="projectManagerId" name="projectManagerId" defaultValue={client.projectManagerId ?? ""} className="input"><option value="">Not allocated yet</option>{staff.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div>
            {client.clientType === "SAAS" && <div><label className="label" htmlFor="supportManagerId">Support manager</label><select id="supportManagerId" name="supportManagerId" defaultValue={client.supportManagerId ?? ""} className="input"><option value="">Project manager covers support</option>{staff.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div>}
            <div className="flex items-end"><SubmitButton pendingText="Saving…">Save</SubmitButton></div>
          </form>
        ) : <p className="text-sm">{CLIENT_TYPE_LABEL[client.clientType]} · project manager: {pm?.name ?? "not allocated yet"}</p>}
      </section>

      {engagements.length === 0 ? <Empty title="No services yet">Add a retainer or a single service order below.</Empty> : engagements.map((e) => (
        <section key={e.id} className="card space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">{e.name}</h2>
            <span className="flex items-center gap-2 text-sm">{formatMoney(e.amount, e.currency)} <span className="text-muted">{INTERVAL_LABEL[e.interval]}</span><Badge tone="neutral">{e.kind === "RETAINER" ? "retainer" : "single service"}</Badge><StatusBadge status={e.status} /></span>
          </div>
          <p className="text-xs text-muted">Started {e.startDate}{e.endDate ? `, ended ${e.endDate}` : ""}{e.interval === "ONE_TIME" ? " · one-time work, not counted in MRR or ARR" : ""}</p>
          {(quotas.get(e.id) ?? []).length > 0 && (
            <ul className="space-y-2 text-sm">
              {quotas.get(e.id)!.map((q) => (
                <li key={q.key}>
                  <div className="flex justify-between"><span>{q.label}</span><span className={q.over ? "font-medium text-danger" : "text-muted"}>{q.used} of {q.limit}{q.period === "MONTH" ? ` in ${month}` : " in total"}{q.over ? ` (over by ${q.over})` : ""}</span></div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-hover" role="progressbar" aria-valuenow={Math.min(q.used, q.limit)} aria-valuemin={0} aria-valuemax={q.limit} aria-label={q.label}><div className={`h-full rounded-full ${q.over ? "bg-danger" : "bg-primary"}`} style={{ width: `${Math.min(100, (q.used / q.limit) * 100)}%` }} /></div>
                </li>
              ))}
            </ul>
          )}
          {canEdit && e.status === "ACTIVE" && (quotas.get(e.id) ?? []).length > 0 && (
            <form action={recordUsage} className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
              <input type="hidden" name="clientId" value={client.id} /><input type="hidden" name="engagementId" value={e.id} />
              <div><label className="label" htmlFor={`k-${e.id}`}>Delivered</label><select id={`k-${e.id}`} name="key" className="input">{quotas.get(e.id)!.map((q) => <option key={q.key} value={q.key}>{q.label}</option>)}</select></div>
              <div><label className="label" htmlFor={`q-${e.id}`}>How many</label><input id={`q-${e.id}`} name="quantity" type="number" min={1} defaultValue={1} className="input !w-24" /></div>
              <div className="min-w-40 flex-1"><label className="label" htmlFor={`n-${e.id}`}>Note</label><input id={`n-${e.id}`} name="note" maxLength={300} className="input" /></div>
              <SubmitButton className="btn-ghost" pendingText="Saving…">Count it</SubmitButton>
            </form>
          )}
          {e.usage.length > 0 && (
            <details className="text-sm"><summary className="cursor-pointer text-muted">Recent deliveries ({e.usage.length})</summary>
              <ul className="mt-2">{e.usage.map((u) => <li key={u.id} className="flex items-center justify-between gap-2 border-t border-border py-1 first:border-0"><span>{u.quantity} × {QUOTA_LABEL[u.key] ?? u.key} <span className="text-xs text-muted">{u.period}{u.note ? ` · ${u.note}` : ""}</span></span>{canEdit && <form action={voidUsageEntry}><input type="hidden" name="clientId" value={client.id} /><input type="hidden" name="usageId" value={u.id} /><button className="underline text-xs">Void</button></form>}</li>)}</ul>
            </details>
          )}
          {canEdit && (
            <form action={changeEngagementStatus} className="flex flex-wrap items-center gap-2 border-t border-border pt-3 text-sm">
              <input type="hidden" name="clientId" value={client.id} /><input type="hidden" name="engagementId" value={e.id} />
              <label className="sr-only" htmlFor={`s-${e.id}`}>Status</label>
              <select id={`s-${e.id}`} name="status" defaultValue={e.status} className="input !w-40">{["ACTIVE", "PAUSED", "ENDED", "CANCELLED"].map((s) => <option key={s} value={s}>{s.toLowerCase()}</option>)}</select>
              <SubmitButton className="btn-ghost" pendingText="Saving…">Change status</SubmitButton>
            </form>
          )}
        </section>
      ))}

      {canEdit && (
        <div className="grid gap-5 lg:grid-cols-2">
          <form action={addEngagement} className="card space-y-3">
            <input type="hidden" name="clientId" value={client.id} /><input type="hidden" name="kind" value="RETAINER" />
            <h2 className="font-semibold">Start a retainer</h2>
            <p className="text-xs text-muted">Recurring work with monthly quotas. Pick a catalog plan to copy its price in {client.currency} and its quotas. The price can be overridden. Counts toward MRR and ARR.</p>
            <div><label className="label" htmlFor="rp">Plan</label><select id="rp" name="planId" className="input"><option value="">Custom (no plan)</option>{plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
            <div><label className="label" htmlFor="rn">Name (needed without a plan)</label><input id="rn" name="name" maxLength={120} className="input" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label" htmlFor="ri">Billed</label><select id="ri" name="interval" className="input"><option value="MONTHLY">Monthly</option><option value="QUARTERLY">Quarterly</option><option value="ANNUAL">Annually</option></select></div>
              <div><label className="label" htmlFor="ra">Price in {client.currency}</label><input id="ra" name="amount" inputMode="decimal" placeholder="From the plan" className="input" /></div>
            </div>
            <div><label className="label" htmlFor="rs">Start date</label><input id="rs" name="startDate" type="date" required defaultValue={today} className="input" /></div>
            <SubmitButton pendingText="Starting…">Start retainer</SubmitButton>
          </form>
          <form action={addEngagement} className="card space-y-3">
            <input type="hidden" name="clientId" value={client.id} /><input type="hidden" name="kind" value="SINGLE_SERVICE" />
            <h2 className="font-semibold">Add a single service</h2>
            <p className="text-xs text-muted">One-off work, for example 2 ad campaigns. Priced per unit. One-time, so it is never counted in MRR or ARR.</p>
            <div><label className="label" htmlFor="ss">Service</label><select id="ss" name="serviceKey" className="input">{QUOTA_KEYS.map((k) => <option key={k} value={k}>{QUOTA_LABEL[k]}</option>)}</select></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label" htmlFor="sq">How many</label><input id="sq" name="quantity" type="number" min={1} defaultValue={1} required className="input" /></div>
              <div><label className="label" htmlFor="su">Price of each ({client.currency})</label><input id="su" name="unitPrice" inputMode="decimal" required className="input" /></div>
            </div>
            <div><label className="label" htmlFor="sd">Start date</label><input id="sd" name="startDate" type="date" required defaultValue={today} className="input" /></div>
            <SubmitButton pendingText="Adding…">Add service</SubmitButton>
          </form>
        </div>
      )}
      <p className="text-xs text-muted">Billing still runs through subscriptions and invoices. This records what the client bought, what it includes and how much of it has been delivered.</p>
    </div>
  );
}
