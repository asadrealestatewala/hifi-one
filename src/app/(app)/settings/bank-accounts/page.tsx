import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { maskAccount } from "@/lib/mask";

export const dynamic = "force-dynamic";

const opt = z.string().trim().max(300).optional().transform((v) => (v ? v : null));

const schema = z.object({
  internalName: z.string().trim().min(2).max(100),
  bankName: z.string().trim().min(2).max(150),
  accountHolder: z.string().trim().min(2).max(200),
  accountNumber: z.string().trim().min(4).max(60),
  iban: opt,
  swift: opt,
  routingCode: opt,
  country: opt,
  branchName: opt,
  currency: z.enum(["PKR", "USD", "AED", "GBP"]),
  paymentInstructions: opt,
});

// Audit entries never contain the full account number.
const safe = <T extends { accountNumber: string; iban: string | null }>(a: T) => ({
  ...a,
  accountNumber: maskAccount(a.accountNumber),
  iban: a.iban ? maskAccount(a.iban) : null,
});

async function addAccount(formData: FormData) {
  "use server";
  const user = await requirePermission("bank.edit");
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const hasDefault = await db.bankAccount.findFirst({
    where: { organizationId: user.organizationId, currency: parsed.data.currency, isDefault: true, active: true },
  });
  // Each bank account gets its own ledger account so payments post to the right cash/bank balance.
  const created = await db.$transaction(async (tx) => {
    const existing = await tx.account.findMany({
      where: { organizationId: user.organizationId, code: { startsWith: "11" } },
      select: { code: true },
    });
    const next = Math.max(1099, ...existing.map((a) => Number(a.code))) + 1;
    const ledger = await tx.account.create({
      data: {
        organizationId: user.organizationId,
        code: String(next),
        name: `Bank - ${parsed.data.internalName} (${parsed.data.currency})`,
        type: "ASSET",
      },
    });
    return tx.bankAccount.create({
      data: { ...parsed.data, organizationId: user.organizationId, isDefault: !hasDefault, ledgerAccountId: ledger.id },
    });
  });
  await audit(user, { action: "bank_account.create", entity: "BankAccount", entityId: created.id, after: safe(created) });
  revalidatePath("/settings/bank-accounts");
}

async function toggleActive(formData: FormData) {
  "use server";
  const user = await requirePermission("bank.edit");
  const id = String(formData.get("id"));
  const before = await db.bankAccount.findFirstOrThrow({ where: { id, organizationId: user.organizationId } });
  const after = await db.bankAccount.update({
    where: { id },
    data: { active: !before.active, isDefault: before.active ? false : before.isDefault },
  });
  await audit(user, {
    action: before.active ? "bank_account.deactivate" : "bank_account.activate",
    entity: "BankAccount",
    entityId: id,
    before: safe(before),
    after: safe(after),
  });
  revalidatePath("/settings/bank-accounts");
}

async function makeDefault(formData: FormData) {
  "use server";
  const user = await requirePermission("bank.edit");
  const id = String(formData.get("id"));
  const acct = await db.bankAccount.findFirstOrThrow({ where: { id, organizationId: user.organizationId, active: true } });
  await db.$transaction([
    db.bankAccount.updateMany({
      where: { organizationId: user.organizationId, currency: acct.currency },
      data: { isDefault: false },
    }),
    db.bankAccount.update({ where: { id }, data: { isDefault: true } }),
  ]);
  await audit(user, { action: "bank_account.set_default", entity: "BankAccount", entityId: id, after: { currency: acct.currency } });
  revalidatePath("/settings/bank-accounts");
}

export default async function BankAccounts() {
  const user = await requirePermission("bank.view");
  const canEdit = user.permissions.has("bank.edit");
  const full = user.permissions.has("bank.view_full");
  const accounts = await db.bankAccount.findMany({
    where: { organizationId: user.organizationId },
    orderBy: [{ currency: "asc" }, { createdAt: "asc" }],
  });
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Bank Accounts</h1>
        <p className="text-sm text-muted">
          Account numbers are masked unless your role allows full access. Entering details here does not verify the
          account. Issued invoices keep the bank details they were issued with.
        </p>
      </div>
      <div className="card overflow-x-auto">
        {accounts.length === 0 ? (
          <p className="text-sm text-muted">No bank accounts yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-hover/60 text-left text-xs text-muted">
              <tr>
                <th className="py-2 pr-4">Account</th>
                <th className="pr-4">Bank</th>
                <th className="pr-4">Number</th>
                <th className="pr-4">Currency</th>
                <th className="pr-4">Status</th>
                {canEdit && <th></th>}
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => (
                <tr key={a.id} className="border-t border-border transition hover:bg-hover/50">
                  <td className="py-2 pr-4 font-medium">{a.internalName}</td>
                  <td className="pr-4">{a.bankName}</td>
                  <td className="pr-4 font-mono">{full ? a.accountNumber : maskAccount(a.accountNumber)}</td>
                  <td className="pr-4">{a.currency}</td>
                  <td className="pr-4">
                    {a.active ? "Active" : "Inactive"}
                    {a.isDefault && " · Default"}
                    {!a.verified && " · Unverified"}
                  </td>
                  {canEdit && (
                    <td className="flex gap-2 py-2">
                      {a.active && !a.isDefault && (
                        <form action={makeDefault}>
                          <input type="hidden" name="id" value={a.id} />
                          <button className="btn-ghost">Make default</button>
                        </form>
                      )}
                      <form action={toggleActive}>
                        <input type="hidden" name="id" value={a.id} />
                        <button className="btn-ghost">{a.active ? "Deactivate" : "Activate"}</button>
                      </form>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {canEdit && (
        <form action={addAccount} className="card grid gap-4 sm:grid-cols-2">
          <h2 className="font-semibold sm:col-span-2">Add bank account</h2>
          {[
            ["internalName", "Internal name", true],
            ["bankName", "Bank name", true],
            ["accountHolder", "Account holder / legal entity", true],
            ["accountNumber", "Account number", true],
            ["iban", "IBAN", false],
            ["swift", "SWIFT / BIC", false],
            ["routingCode", "Routing number or sort code", false],
            ["country", "Country", false],
            ["branchName", "Bank branch", false],
          ].map(([name, label, req]) => (
            <div key={String(name)}>
              <label className="label" htmlFor={String(name)}>{String(label)}</label>
              <input id={String(name)} name={String(name)} required={Boolean(req)} className="input" />
            </div>
          ))}
          <div>
            <label className="label" htmlFor="currency">Currency</label>
            <select id="currency" name="currency" className="input">
              {["PKR", "USD", "AED", "GBP"].map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="paymentInstructions">Payment instructions for invoices</label>
            <textarea id="paymentInstructions" name="paymentInstructions" rows={3} className="input" />
          </div>
          <div className="sm:col-span-2">
            <button className="btn">Add account</button>
          </div>
        </form>
      )}
    </div>
  );
}
