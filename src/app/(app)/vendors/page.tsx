import Link from "next/link";
import { redirect } from "next/navigation";
import { audit, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { VendorError, createVendor } from "@/lib/vendors";

export const dynamic = "force-dynamic";

async function create(formData: FormData) {
  "use server";
  const user = await requirePermission("vendors.manage");
  let id: string;
  try {
    const v = await createVendor(db, {
      organizationId: user.organizationId, name: String(formData.get("name") ?? ""), email: String(formData.get("email") ?? ""), phone: String(formData.get("phone") ?? ""),
      country: String(formData.get("country") ?? ""), currency: String(formData.get("currency")), categories: String(formData.get("categories") ?? ""),
      paymentTermsDays: Number(formData.get("paymentTermsDays") ?? 30) || 30,
    });
    id = v.id;
    await audit(user, { action: "vendor.create", entity: "Vendor", entityId: v.id, after: { name: v.name, code: v.code } });
  } catch (e) {
    if (e instanceof VendorError) redirect(`/vendors?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  redirect(`/vendors/${id}`);
}

export default async function Vendors({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const user = await requirePermission("vendors.view");
  const { error } = await searchParams;
  const vendors = await db.vendor.findMany({ where: { organizationId: user.organizationId }, orderBy: { name: "asc" } });
  const canManage = user.permissions.has("vendors.manage");
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap justify-between gap-2">
        <h1 className="text-2xl font-bold">Vendor Directory</h1>
        <Link href="/procurement" className="btn-ghost">Opportunities, work orders and bills</Link>
      </div>
      <div className="card overflow-x-auto">
        {vendors.length === 0 ? <p className="text-sm text-muted">No vendors yet.</p> : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted"><tr><th className="py-2 pr-4">Code</th><th className="pr-4">Name</th><th className="pr-4">Categories</th><th className="pr-4">Currency</th><th>Status</th></tr></thead>
            <tbody>
              {vendors.map((v) => (
                <tr key={v.id} className="border-t border-border">
                  <td className="py-2 pr-4 text-muted">{v.code}</td>
                  <td className="pr-4 font-medium"><Link href={`/vendors/${v.id}`} className="hover:underline">{v.name}</Link></td>
                  <td className="pr-4">{v.categories}</td><td className="pr-4">{v.currency}</td><td>{v.status.toLowerCase()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {canManage && (
        <form action={create} className="card grid gap-4 sm:grid-cols-2">
          <h2 className="font-semibold sm:col-span-2">Add vendor (starts as pending until approved)</h2>
          {error && <p role="alert" className="sm:col-span-2 text-sm text-brand bg-brand/10 rounded-lg px-3 py-2">{error}</p>}
          <div><label className="label" htmlFor="name">Business name</label><input id="name" name="name" required className="input" /></div>
          <div><label className="label" htmlFor="email">Email</label><input id="email" name="email" type="email" className="input" /></div>
          <div><label className="label" htmlFor="phone">Phone</label><input id="phone" name="phone" className="input" /></div>
          <div><label className="label" htmlFor="country">Country</label><input id="country" name="country" className="input" /></div>
          <div><label className="label" htmlFor="categories">Service categories</label><input id="categories" name="categories" placeholder="Video editing, Web development" className="input" /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><label className="label" htmlFor="currency">Currency</label><select id="currency" name="currency" className="input">{["USD", "PKR", "AED", "GBP"].map((c) => <option key={c}>{c}</option>)}</select></div>
            <div><label className="label" htmlFor="paymentTermsDays">Terms (days)</label><input id="paymentTermsDays" name="paymentTermsDays" type="number" defaultValue={30} className="input" /></div>
          </div>
          <div className="sm:col-span-2"><button className="btn">Add vendor</button></div>
        </form>
      )}
    </div>
  );
}
