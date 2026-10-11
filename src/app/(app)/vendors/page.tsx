import Link from "next/link";
import { redirect } from "next/navigation";
import { audit, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { VendorError, createVendor } from "@/lib/vendors";
import { Avatar, Chips, Empty, NewButton, PageHeader, PanelForm, SearchBox, Stat, StatusBadge } from "@/components/ui";
import Drawer from "@/components/ui/Drawer";

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
    if (e instanceof VendorError) redirect(`/vendors?new=1&error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  redirect(`/vendors/${id}`);
}

type SP = { error?: string; status?: string; q?: string; new?: string };

export default async function Vendors({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePermission("vendors.view");
  const sp = await searchParams;
  const canManage = user.permissions.has("vendors.manage");
  const all = await db.vendor.findMany({ where: { organizationId: user.organizationId }, orderBy: { name: "asc" } });
  const statuses = [...new Set(all.map((v) => v.status))];
  const status = statuses.includes(sp.status ?? "") ? sp.status! : "all";
  const q = sp.q?.trim().toLowerCase();
  const vendors = all.filter((v) => (status === "all" || v.status === status) && (!q || `${v.name} ${v.code} ${v.categories ?? ""}`.toLowerCase().includes(q)));
  const href = (over: Record<string, string | undefined>) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries({ status: status === "all" ? undefined : status, q: sp.q?.trim(), ...over })) if (v) p.set(k, v); const t = p.toString(); return `/vendors${t ? `?${t}` : ""}`; };
  return (
    <div className="space-y-5">
      <PageHeader title="Vendor directory" subtitle="Approved suppliers and freelancers, with their terms." actions={<>
        <Link href="/procurement" className="btn-ghost">Opportunities, work orders and bills</Link>
        {canManage && <NewButton href={href({ new: "1" })}>Add vendor</NewButton>}
      </>} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Vendors" value={all.length} />
        <Stat label="Approved" value={all.filter((v) => v.status === "APPROVED").length} />
        <Stat label="Awaiting approval" value={all.filter((v) => v.status === "PENDING").length} />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <SearchBox q={sp.q?.trim()} placeholder="Search name, code or category" hidden={{ status: status === "all" ? undefined : status }} />
        <Chips current={status} items={[{ key: "all", label: "All", count: all.length, href: href({ status: undefined }) }, ...statuses.map((s) => ({ key: s, label: s.toLowerCase().replace(/^./, (c) => c.toUpperCase()), count: all.filter((v) => v.status === s).length, href: href({ status: s }) }))]} />
      </div>
      {vendors.length === 0 ? <Empty title={q || status !== "all" ? "No vendors match" : "No vendors yet"}>{canManage ? "Add a vendor with the button above. New vendors start as pending until approved." : "Vendors will appear here."}</Empty> : (
        <div className="card overflow-x-auto !p-0">
          <table className="w-full text-sm">
            <thead className="bg-hover/60 text-left text-xs text-muted"><tr><th className="px-4 py-2.5">Vendor</th><th className="pr-4">Categories</th><th className="pr-4">Currency</th><th className="pr-4">Status</th></tr></thead>
            <tbody>
              {vendors.map((v) => (
                <tr key={v.id} className="border-t border-border transition hover:bg-hover/50">
                  <td className="px-4 py-2.5"><Link href={`/vendors/${v.id}`} className="flex items-center gap-3"><Avatar name={v.name} /><span><span className="block font-medium hover:underline">{v.name}</span><span className="text-xs text-muted">{v.code}</span></span></Link></td>
                  <td className="pr-4 text-muted">{v.categories}</td><td className="pr-4">{v.currency}</td><td className="pr-4"><StatusBadge status={v.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {canManage && sp.new && (
        <Drawer title="Add vendor" closeTo={href({ new: undefined })}>
          <PanelForm action={create} closeTo={href({ new: undefined })} submit="Add vendor" error={sp.error} hint="Starts as pending until approved.">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2"><label className="label" htmlFor="name">Business name</label><input id="name" name="name" required className="input" /></div>
              <div><label className="label" htmlFor="email">Email</label><input id="email" name="email" type="email" className="input" /></div>
              <div><label className="label" htmlFor="phone">Phone</label><input id="phone" name="phone" className="input" /></div>
              <div><label className="label" htmlFor="country">Country</label><input id="country" name="country" className="input" /></div>
              <div><label className="label" htmlFor="categories">Service categories</label><input id="categories" name="categories" placeholder="Video editing, Web development" className="input" /></div>
              <div><label className="label" htmlFor="currency">Currency</label><select id="currency" name="currency" className="input">{["USD", "PKR", "AED", "GBP"].map((c) => <option key={c}>{c}</option>)}</select></div>
              <div><label className="label" htmlFor="paymentTermsDays">Terms (days)</label><input id="paymentTermsDays" name="paymentTermsDays" type="number" defaultValue={30} className="input" /></div>
            </div>
          </PanelForm>
        </Drawer>
      )}
    </div>
  );
}
