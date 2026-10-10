import Link from "next/link";
import { redirect } from "next/navigation";
import { z } from "zod";
import { audit, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const opt = z.string().trim().max(300).optional().transform((v) => (v ? v : null));
const schema = z.object({
  name: z.string().trim().min(2, "Client name is required").max(200),
  email: z.string().trim().email("Enter a valid email").or(z.literal("")).transform((v) => (v ? v.toLowerCase() : null)),
  phone: opt,
  billingAddress: opt,
  country: opt,
  taxId: opt,
  currency: z.enum(["PKR", "USD", "AED", "GBP"]),
  paymentTermsDays: z.coerce.number().int().min(0).max(365),
});

async function createClient(formData: FormData) {
  "use server";
  const user = await requirePermission("clients.edit");
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect(`/clients?error=${encodeURIComponent(parsed.error.issues[0].message)}`);
  const dup = await db.client.findFirst({
    where: { organizationId: user.organizationId, name: { equals: parsed.data.name, mode: "insensitive" } },
  });
  if (dup) redirect(`/clients?error=${encodeURIComponent("A client with this name already exists.")}`);
  const seq = await db.numberSequence.upsert({
    where: { organizationId_key: { organizationId: user.organizationId, key: "CLIENT" } },
    create: { organizationId: user.organizationId, key: "CLIENT", next: 2 },
    update: { next: { increment: 1 } },
  });
  const client = await db.client.create({
    data: { ...parsed.data, organizationId: user.organizationId, code: `C-${String(seq.next - 1).padStart(4, "0")}` },
  });
  await audit(user, { action: "client.create", entity: "Client", entityId: client.id, after: { name: client.name, code: client.code } });
  redirect(`/clients/${client.id}`);
}

export default async function Clients({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const user = await requirePermission("clients.view");
  const { error } = await searchParams;
  const clients = await db.client.findMany({ where: { organizationId: user.organizationId }, orderBy: { name: "asc" } });
  const canEdit = user.permissions.has("clients.edit");
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Client Accounts</h1>
      <div className="card overflow-x-auto">
        {clients.length === 0 ? (
          <p className="text-sm text-muted">No clients yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted">
              <tr><th className="py-2 pr-4">Code</th><th className="pr-4">Name</th><th className="pr-4">Email</th><th className="pr-4">Currency</th><th>Terms</th></tr>
            </thead>
            <tbody>
              {clients.map((c) => (
                <tr key={c.id} className="border-t border-border">
                  <td className="py-2 pr-4 text-muted">{c.code}</td>
                  <td className="pr-4 font-medium"><Link className="hover:underline" href={`/clients/${c.id}`}>{c.name}</Link></td>
                  <td className="pr-4">{c.email}</td>
                  <td className="pr-4">{c.currency}</td>
                  <td>{c.paymentTermsDays} days</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {canEdit && (
        <form action={createClient} className="card grid gap-4 sm:grid-cols-2">
          <h2 className="font-semibold sm:col-span-2">Add client</h2>
          {error && <p role="alert" className="sm:col-span-2 text-sm text-brand bg-brand/10 rounded-lg px-3 py-2">{error}</p>}
          {[["name", "Client name", true], ["email", "Email", false], ["phone", "Phone", false], ["country", "Country", false], ["taxId", "Tax ID", false]].map(([n, l, r]) => (
            <div key={String(n)}>
              <label className="label" htmlFor={String(n)}>{String(l)}</label>
              <input id={String(n)} name={String(n)} required={Boolean(r)} className="input" />
            </div>
          ))}
          <div>
            <label className="label" htmlFor="currency">Billing currency</label>
            <select id="currency" name="currency" className="input" defaultValue="USD">
              {["PKR", "USD", "AED", "GBP"].map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="paymentTermsDays">Payment terms (days)</label>
            <input id="paymentTermsDays" name="paymentTermsDays" type="number" defaultValue={14} min={0} max={365} className="input" />
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="billingAddress">Billing address</label>
            <textarea id="billingAddress" name="billingAddress" rows={2} className="input" />
          </div>
          <div className="sm:col-span-2"><button className="btn">Add client</button></div>
        </form>
      )}
    </div>
  );
}
