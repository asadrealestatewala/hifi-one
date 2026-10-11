import { redirect } from "next/navigation";
import { audit, requirePermission } from "@/lib/auth";
import { CommissionError, accrueCommissions, addBonus, approveEntry, payEntry, setRule, voidEntry } from "@/lib/commissions";
import { db } from "@/lib/db";
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
      await voidEntry(db, { organizationId: org, entryId: s("entryId") });
      await audit(user, { action: "commission.void", entity: "CommissionEntry", entityId: s("entryId") });
    }
  } catch (e) {
    if (e instanceof CommissionError) return back("error", e.message);
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

export default async function Commissions({ searchParams }: { searchParams: Promise<{ error?: string; msg?: string }> }) {
  const user = await requirePermission("commissions.manage");
  const sp = await searchParams;
  const org = user.organizationId;
  const canApprove = user.permissions.has("commissions.approve");
  const canPay = canApprove && user.permissions.has("finance.post");
  const [rules, entries, staff, banks] = await Promise.all([
    db.commissionRule.findMany({ where: { organizationId: org } }),
    db.commissionEntry.findMany({ where: { organizationId: org, status: { in: ["EARNED", "APPROVED"] } }, orderBy: { createdAt: "asc" }, take: 200 }),
    db.user.findMany({ where: { organizationId: org, userType: "EMPLOYEE", active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    canPay ? db.bankAccount.findMany({ where: { organizationId: org, active: true, ledgerAccountId: { not: null } } }) : Promise.resolve([]),
  ]);
  const name = new Map(staff.map((u) => [u.id, u.name]));
  const ruleOf = new Map(rules.map((r) => [r.userId, r]));
  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">Commissions and bonuses</h1>
        <form action={manage}><input type="hidden" name="op" value="accrue" /><button className="btn">Work out new commissions</button></form>
      </div>
      <p className="text-sm text-muted">A salesperson earns a percentage of the revenue (before tax) on money actually received from clients they converted, one commission per payment. Approval books the cost; paying it settles the liability. Nobody can approve their own payout.</p>
      {sp.msg && <p className="text-sm bg-green-600/10 text-green-700 rounded-lg px-3 py-2">{sp.msg}</p>}
      {sp.error && <p role="alert" className="text-sm text-brand bg-brand/10 rounded-lg px-3 py-2">{sp.error}</p>}

      <section className="card overflow-x-auto">
        <h2 className="font-semibold mb-2">Waiting for approval or payment</h2>
        {entries.length === 0 ? <p className="text-sm text-muted">Nothing waiting.</p> : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted"><tr><th className="py-1 pr-3">Who</th><th className="pr-3">What</th><th className="pr-3 text-right">Amount</th><th className="pr-3">Status</th><th></th></tr></thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className="border-t border-border align-top">
                  <td className="py-2 pr-3">{name.get(e.userId) ?? "Unknown"}</td>
                  <td className="pr-3">{e.kind === "BONUS" ? `Bonus: ${e.note}` : `${e.ratePercent.toString()}% of ${formatMoney(e.base, e.currency)}`}</td>
                  <td className="pr-3 text-right">{formatMoney(e.amount, e.currency)}</td><td className="pr-3">{e.status.toLowerCase()}</td>
                  <td className="space-y-1">
                    {e.status === "EARNED" && canApprove && <form action={decide}><input type="hidden" name="entryId" value={e.id} /><input type="hidden" name="op" value="approve" /><button className="underline text-xs">{e.userId === user.id ? "Approve (not your own)" : "Approve"}</button></form>}
                    {e.status === "EARNED" && <form action={manage}><input type="hidden" name="entryId" value={e.id} /><input type="hidden" name="op" value="void" /><button className="underline text-xs">Void</button></form>}
                    {e.status === "APPROVED" && canPay && (
                      <form action={decide} className="flex gap-1"><input type="hidden" name="entryId" value={e.id} /><input type="hidden" name="op" value="pay" />
                        <select name="bankAccountId" aria-label="Pay from" className="input !py-0.5 text-xs">{banks.filter((b) => b.currency === e.currency).map((b) => <option key={b.id} value={b.id}>{b.internalName}</option>)}</select>
                        <button className="btn !py-0.5 text-xs">Mark paid</button></form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
