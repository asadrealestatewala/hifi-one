import { redirect } from "next/navigation";
import { audit, requirePermission } from "@/lib/auth";
import { ACCOUNT_TYPES, accountBalances, createAccount, updateAccount } from "@/lib/bookkeeping";
import { db } from "@/lib/db";
import { LedgerError, dec } from "@/lib/ledger-math";
import { Notice, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

const fail = (m: string): never => redirect(`/finance/accounts?error=${encodeURIComponent(m)}`);

async function add(formData: FormData) {
  "use server";
  const user = await requirePermission("coa.manage");
  try {
    const a = await createAccount(db, { organizationId: user.organizationId, code: String(formData.get("code") ?? ""), name: String(formData.get("name") ?? ""), type: String(formData.get("type")) });
    await audit(user, { action: "account.create", entity: "Account", entityId: a.id, after: { code: a.code, name: a.name, type: a.type } });
  } catch (e) {
    if (e instanceof LedgerError) fail(e.message);
    throw e;
  }
  redirect("/finance/accounts");
}

async function change(formData: FormData) {
  "use server";
  const user = await requirePermission("coa.manage");
  const id = String(formData.get("id"));
  const op = String(formData.get("op"));
  try {
    if (op === "rename") await updateAccount(db, { organizationId: user.organizationId, id, name: String(formData.get("name") ?? "") });
    else if (op === "deactivate") await updateAccount(db, { organizationId: user.organizationId, id, active: false });
    else if (op === "activate") await updateAccount(db, { organizationId: user.organizationId, id, active: true });
    else redirect("/finance/accounts");
    await audit(user, { action: `account.${op}`, entity: "Account", entityId: id });
  } catch (e) {
    if (e instanceof LedgerError) fail(e.message);
    throw e;
  }
  redirect("/finance/accounts");
}

export default async function Accounts({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const user = await requirePermission("finance.view");
  const { error } = await searchParams;
  const canManage = user.permissions.has("coa.manage");
  const accounts = await db.account.findMany({ where: { organizationId: user.organizationId }, orderBy: { code: "asc" } });
  const balances = new Map(await Promise.all(accounts.map(async (a) => [a.id, (await accountBalances(db, a.id)).filter((b) => !dec(b.balance).isZero())] as const)));
  return (
    <div className="space-y-6">
      <PageHeader title="Chart of Accounts" subtitle="Codes and types never change once an account exists, because history would stop meaning what it said. Accounts used by automatic postings, or holding a balance, cannot be deactivated." />
      {error && <Notice kind="error">{error}</Notice>}
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-hover/60 text-left text-xs text-muted"><tr><th className="py-2 pr-4">Code</th><th className="pr-4">Name</th><th className="pr-4">Type</th><th className="pr-4">Balance (debit positive)</th><th>Status</th>{canManage && <th></th>}</tr></thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.id} className={`border-t border-border ${a.active ? "" : "text-muted"}`}>
                <td className="py-2 pr-4">{a.code}</td><td className="pr-4">{a.name}{a.systemKey && <span className="ml-2 text-[11px] rounded bg-border px-1.5 py-0.5">system</span>}</td>
                <td className="pr-4">{a.type.replace("_", " ").toLowerCase()}</td>
                <td className="pr-4">{balances.get(a.id)?.map((b) => `${b.currency} ${b.balance}`).join(", ")}</td><td>{a.active ? "active" : "inactive"}</td>
                {canManage && (
                  <td className="py-1">
                    <div className="flex gap-1">
                      <form action={change} className="flex gap-1"><input type="hidden" name="id" value={a.id} /><input type="hidden" name="op" value="rename" /><input name="name" defaultValue={a.name} aria-label={`Name of ${a.code}`} className="input !w-44 !py-1" /><button className="btn-ghost">Rename</button></form>
                      <form action={change}><input type="hidden" name="id" value={a.id} /><input type="hidden" name="op" value={a.active ? "deactivate" : "activate"} /><button className="btn-ghost">{a.active ? "Deactivate" : "Activate"}</button></form>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {canManage && (
        <form action={add} className="card grid gap-3 sm:grid-cols-4">
          <h2 className="font-semibold sm:col-span-4">Add an account</h2>
          <div><label className="label" htmlFor="code">Code</label><input id="code" name="code" required className="input" /></div>
          <div className="sm:col-span-2"><label className="label" htmlFor="name">Name</label><input id="name" name="name" required className="input" /></div>
          <div><label className="label" htmlFor="type">Type</label><select id="type" name="type" className="input">{ACCOUNT_TYPES.map((t) => <option key={t} value={t}>{t.replace("_", " ").toLowerCase()}</option>)}</select></div>
          <div className="sm:col-span-4"><button className="btn">Add account</button></div>
        </form>
      )}
    </div>
  );
}
