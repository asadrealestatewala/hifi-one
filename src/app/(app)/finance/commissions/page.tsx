import { redirect } from "next/navigation";
import { audit, requirePermission } from "@/lib/auth";
import { COMMISSION_ROLES, CommissionError, ROLE_LABEL, accrueCommissions, addBonus, approveEntry, payEntry, setCampaignRate, setRule, voidEntry, campaignRates } from "@/lib/commissions";
import { db } from "@/lib/db";
import { paging } from "@/lib/paging";
import { ConfirmButton, Notice, PageHeader, Pager } from "@/components/ui";
import { readReason } from "@/lib/reasons";
import { DeliveryError, setRebateTier } from "@/lib/delivery";
import { formatMoney } from "@/lib/money";

export const dynamic = "force-dynamic";

const back = (kind: "error" | "msg", m: string) => redirect(`/finance/commissions?${kind}=${encodeURIComponent(m)}`);

async function manage(formData: FormData) {
  "use server";
  const user = await requirePermission("commissions.manage");
  const org = user.organizationId;
  const op = String(formData.get("op") ?? "");
  const s = (k: string) => String(formData.get(k) ?? "");
  try {
    if (op === "rule") {
      const r = await setRule(db, { organizationId: org, userId: s("userId"), ratePercent: s("ratePercent"), active: formData.get("active") === "on", actorId: user.id });
      await audit(user, { action: "commission.rule", entity: "CommissionRule", entityId: r.rule.id, before: r.before ? { rate: r.before.ratePercent.toString(), active: r.before.active } : null, after: { rate: r.rule.ratePercent.toString(), active: r.rule.active } });
      return back("msg", "Rate saved. It applies to payments received from now on.");
    }
    if (op === "campaignRate") {
      const r = await setCampaignRate(db, { organizationId: org, campaignId: s("campaignId"), role: s("role"), ratePercent: s("ratePercent"), active: formData.get("active") === "on", actorId: user.id });
      await audit(user, { action: "commission.campaign_rate", entity: "CampaignCommissionRate", entityId: r.row.id, before: r.before ? { rate: r.before.ratePercent.toString(), active: r.before.active } : null, after: { campaignId: s("campaignId"), role: s("role"), rate: r.row.ratePercent.toString(), active: r.row.active } });
      return back("msg", "Campaign rate saved. It applies to payments received from now on.");
    }
    if (op === "rebateTier") {
      await setRebateTier(db, { organizationId: org, minRating: Number(s("minRating")), percent: s("percent"), actorId: user.id });
      await audit(user, { action: "commission.rebate_tier", entity: "ReviewRebateTier", after: { minRating: s("minRating"), percent: s("percent") } });
      return back("msg", "Rebate tier saved. It applies to reviews recorded from now on.");
    }
    if (op === "accrue") {
      const r = await accrueCommissions(db, { organizationId: org, actorId: user.id });
      await audit(user, { action: "commission.accrue", entity: "CommissionEntry", after: r });
      return back("msg", r.created === 0 ? "Nothing new to work out." : `${r.created} commission${r.created === 1 ? "" : "s"} worked out.`);
    }
    if (op === "bonus") {
      const b = await addBonus(db, { organizationId: org, userId: s("userId"), amount: s("amount"), currency: s("currency"), note: s("note"), actorId: user.id });
      await audit(user, { action: "commission.bonus", entity: "CommissionEntry", entityId: b.id, after: { amount: b.amount.toString(), currency: b.currency } });
      return back("msg", "Bonus added, waiting for approval.");
    }
    if (op === "void") {
      const why = readReason(formData.get("reason"));
      if (!why.ok) return back("error", why.error);
      await voidEntry(db, { organizationId: org, entryId: s("entryId") });
      await audit(user, { action: "commission.void", entity: "CommissionEntry", entityId: s("entryId"), after: { reason: why.reason } });
    }
  } catch (e) {
    if (e instanceof CommissionError || e instanceof DeliveryError) return back("error", e.message);
    throw e;
  }
  redirect("/finance/commissions");
}

async function decide(formData: FormData) {
  "use server";
  const user = await requirePermission("commissions.approve");
  const org = user.organizationId;
  const op = String(formData.get("op") ?? "");
  const entryId = String(formData.get("entryId") ?? "");
  try {
    if (op === "approve") {
      const j = await approveEntry(db, { organizationId: org, entryId, approverId: user.id });
      await audit(user, { action: "commission.approve", entity: "CommissionEntry", entityId: entryId, after: { journal: j.number } });
    } else if (op === "pay") {
      await requirePermission("finance.post");
      const j = await payEntry(db, { organizationId: org, entryId, bankAccountId: String(formData.get("bankAccountId") ?? ""), actorId: user.id });
      await audit(user, { action: "commission.pay", entity: "CommissionEntry", entityId: entryId, after: { journal: j.number } });
    }
  } catch (e) {
    if (e instanceof CommissionError) return back("error", e.message);
    throw e;
  }
  redirect("/finance/commissions");
}

export default async function Commissions({ searchParams }: { searchParams: Promise<{ error?: string; msg?: string; page?: string }> }) {
  const user = await requirePermission("commissions.manage");
  const sp = await searchParams;
  const org = user.organizationId;
  const canApprove = user.permissions.has("commissions.approve");
  const canPay = canApprove && user.permissions.has("finance.post");
  const pg = paging(sp.page);
  const waiting = { organizationId: org, status: { in: ["EARNED", "APPROVED"] as never } };
  const [rules, entries, waitingCount, staff, banks, campaigns, crates, tiers] = await Promise.all([
    db.commissionRule.findMany({ where: { organizationId: org } }),
    db.commissionEntry.findMany({ where: waiting, orderBy: [{ createdAt: "asc" }, { id: "asc" }], skip: pg.skip, take: pg.take }),
    db.commissionEntry.count({ where: waiting }),
    db.user.findMany({ where: { organizationId: org, userType: "EMPLOYEE", active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    canPay ? db.bankAccount.findMany({ where: { organizationId: org, active: true, ledgerAccountId: { not: null } } }) : Promise.resolve([]),
    db.campaign.findMany({ where: { organizationId: org, archivedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    campaignRates(db, org),
    db.reviewRebateTier.findMany({ where: { organizationId: org }, orderBy: { minRating: "desc" } }),
  ]);
  const name = new Map(staff.map((u) => [u.id, u.name]));
  const ruleOf = new Map(rules.map((r) => [r.userId, r]));
  return (
    <div className="space-y-6 max-w-4xl">
      <PageHeader title="Commissions and bonuses" actions={<form action={manage}><input type="hidden" name="op" value="accrue" /><button className="btn">Work out new commissions</button></form>} />
      <p className="text-sm text-muted">A salesperson earns a percentage of the revenue (before tax) on money actually received from clients they converted, one commission per payment. Approval books the cost; paying it settles the liability. Approved entries are paid with the next payroll run in the same currency, or here by hand if they are not in a run. Nobody can approve their own payout.</p>
      {sp.msg && <Notice kind="ok">{sp.msg}</Notice>}
      {sp.error && <Notice kind="error">{sp.error}</Notice>}

      <section className="card overflow-x-auto">
        <h2 className="font-semibold mb-2">Waiting for approval or payment</h2>
        {entries.length === 0 ? <p className="text-sm text-muted">Nothing waiting.</p> : (<>
          <table className="w-full text-sm">
            <thead className="bg-hover/60 text-left text-xs text-muted"><tr><th className="py-1 pr-3">Who</th><th className="pr-3">What</th><th className="pr-3 text-right">Amount</th><th className="pr-3">Status</th><th></th></tr></thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className="border-t border-border align-top">
                  <td className="py-2 pr-3">{name.get(e.userId) ?? "Unknown"}</td>
                  <td className="pr-3">{e.kind === "BONUS" ? `Bonus: ${e.note}` : `${e.role === "SALES_MANAGER" ? "Manager share: " : ""}${e.ratePercent.toString()}% of ${formatMoney(e.base, e.currency)}`}</td>
                  <td className="pr-3 text-right">{formatMoney(e.amount, e.currency)}</td><td className="pr-3">{e.status.toLowerCase()}</td>
                  <td className="space-y-1">
                    {e.status === "EARNED" && canApprove && <form action={decide}><input type="hidden" name="entryId" value={e.id} /><input type="hidden" name="op" value="approve" /><button className="underline text-xs">{e.userId === user.id ? "Approve (not your own)" : "Approve"}</button></form>}
                    {e.status === "EARNED" && <form action={manage}><input type="hidden" name="entryId" value={e.id} /><input type="hidden" name="op" value="void" /><ConfirmButton className="underline text-xs" title="Void this commission?" message="The person will not be paid this amount. It cannot be restored; a new bonus would be needed." confirmLabel="Void" reason>Void</ConfirmButton></form>}
                    {e.status === "APPROVED" && e.payrollRunId && <p className="text-xs text-muted">Being paid through payroll</p>}
                    {e.status === "APPROVED" && !e.payrollRunId && canPay && (
                      <form action={decide} className="flex gap-1"><input type="hidden" name="entryId" value={e.id} /><input type="hidden" name="op" value="pay" />
                        <select name="bankAccountId" aria-label="Pay from" className="input !py-0.5 text-xs">{banks.filter((b) => b.currency === e.currency).map((b) => <option key={b.id} value={b.id}>{b.internalName}</option>)}</select>
                        <button className="btn !py-0.5 text-xs">Mark paid</button></form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pager page={pg.page} size={pg.size} total={waitingCount} href={(n) => (n > 1 ? `/finance/commissions?page=${n}` : "/finance/commissions")} /></>
        )}
      </section>

      <section className="card space-y-3">
        <h2 className="font-semibold">Rates</h2>
        <ul className="text-sm">{staff.filter((u) => ruleOf.has(u.id)).map((u) => { const r = ruleOf.get(u.id)!; return <li key={u.id} className="flex justify-between border-t border-border py-1 first:border-0"><span>{u.name}</span><span>{r.ratePercent.toString()}%{!r.active && " (off)"}</span></li>; })}
          {rules.length === 0 && <li className="text-muted">No rates set yet, so nobody is earning commission.</li>}</ul>
        <form action={manage} className="flex flex-wrap items-end gap-3 border-t border-border pt-3">
          <input type="hidden" name="op" value="rule" />
          <div><label className="label" htmlFor="ruleUser">Person</label><select id="ruleUser" name="userId" required className="input"><option value="">Choose…</option>{staff.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div>
          <div><label className="label" htmlFor="ratePercent">Rate (%)</label><input id="ratePercent" name="ratePercent" required inputMode="decimal" className="input !w-24" /></div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked /> Active</label>
          <button className="btn-ghost">Save rate</button>
        </form>
        <p className="text-xs text-muted">A new or changed rate applies to payments received after it is saved, never to past ones.</p>
      </section>

      <section className="card space-y-3">
        <h2 className="font-semibold">Rates by campaign or product</h2>
        <p className="text-xs text-muted">What each campaign pays the sales agent who closed the client and that agent&apos;s manager (for example 3% for digital marketing, 5% for an Agentify ERP subscription). Sales staff see these on My commissions. A campaign rate wins over a person&apos;s own rate; without one, the personal rate above still applies. The manager is the agent&apos;s manager in the staff directory.</p>
        <ul className="text-sm">{crates.map((c) => <li key={c.campaignId} className="flex flex-wrap justify-between gap-2 border-t border-border py-1 first:border-0"><span>{c.campaign}{c.category ? <span className="text-xs text-muted"> · {c.category}</span> : null}</span><span>agent {c.agent ? `${c.agent}%` : "none"} · manager {c.manager ? `${c.manager}%` : "none"}</span></li>)}
          {crates.length === 0 && <li className="text-muted">No campaign rates set yet.</li>}</ul>
        <form action={manage} className="flex flex-wrap items-end gap-3 border-t border-border pt-3">
          <input type="hidden" name="op" value="campaignRate" />
          <div><label className="label" htmlFor="crCampaign">Campaign</label><select id="crCampaign" name="campaignId" required className="input"><option value="">Choose…</option>{campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
          <div><label className="label" htmlFor="crRole">Paid to</label><select id="crRole" name="role" className="input">{COMMISSION_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></div>
          <div><label className="label" htmlFor="crRate">Rate (%)</label><input id="crRate" name="ratePercent" required inputMode="decimal" className="input !w-24" /></div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked /> Active</label>
          <button className="btn-ghost">Save campaign rate</button>
        </form>
      </section>

      <section className="card space-y-3">
        <h2 className="font-semibold">Weekly review rebate</h2>
        <p className="text-xs text-muted">When the customer success manager records a client&apos;s weekly review, the highest tier the rating reaches sets how much of that client&apos;s weekly retainer is shared equally between the project manager and the staff on the client&apos;s projects. Each share is a bonus waiting for approval below. Enter 0 to remove a tier.</p>
        <ul className="text-sm">{tiers.map((t) => <li key={t.id} className="flex justify-between border-t border-border py-1 first:border-0"><span>{t.minRating} stars or more</span><span>{t.percent.toString()}% of the weekly retainer</span></li>)}
          {tiers.length === 0 && <li className="text-muted">No tiers yet, so reviews earn no rebate.</li>}</ul>
        <form action={manage} className="flex flex-wrap items-end gap-3 border-t border-border pt-3">
          <input type="hidden" name="op" value="rebateTier" />
          <div><label className="label" htmlFor="rtRating">From rating</label><select id="rtRating" name="minRating" className="input">{[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n} stars</option>)}</select></div>
          <div><label className="label" htmlFor="rtPercent">Percent</label><input id="rtPercent" name="percent" required inputMode="decimal" className="input !w-24" /></div>
          <button className="btn-ghost">Save tier</button>
        </form>
      </section>

      <form action={manage} className="card grid gap-3 sm:grid-cols-5 items-end">
        <input type="hidden" name="op" value="bonus" />
        <h2 className="font-semibold sm:col-span-5">Add a bonus (for example a target met)</h2>
        <div><label className="label" htmlFor="bonusUser">Person</label><select id="bonusUser" name="userId" required className="input"><option value="">Choose…</option>{staff.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div>
        <div><label className="label" htmlFor="bonusAmount">Amount</label><input id="bonusAmount" name="amount" required inputMode="decimal" className="input" /></div>
        <div><label className="label" htmlFor="bonusCurrency">Currency</label><select id="bonusCurrency" name="currency" className="input">{["PKR", "USD", "AED", "GBP"].map((c) => <option key={c}>{c}</option>)}</select></div>
        <div className="sm:col-span-2"><label className="label" htmlFor="bonusNote">Reason</label><input id="bonusNote" name="note" required minLength={3} maxLength={300} className="input" /></div>
        <button className="btn-ghost sm:col-span-5 sm:w-fit">Add bonus</button>
      </form>
    </div>
  );
}
