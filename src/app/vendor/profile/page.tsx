import { redirect } from "next/navigation";
import { audit, requireVendorUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { Notice, PageHeader, StatusBadge, SubmitButton } from "@/components/ui";

export const dynamic = "force-dynamic";

async function save(formData: FormData) {
  "use server";
  const user = await requireVendorUser();
  const email = String(formData.get("email") ?? "").trim().toLowerCase().slice(0, 200);
  const phone = String(formData.get("phone") ?? "").trim().slice(0, 40);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) redirect(`/vendor/profile?error=${encodeURIComponent("Enter a valid email address.")}`);
  // The vendor is taken from the signed-in account, never from the form, and only these two contact fields can change
  await db.vendor.update({ where: { id: user.vendorId }, data: { email: email || null, phone: phone || null } });
  await audit(user, { action: "vendor.update_contact", entity: "Vendor", entityId: user.vendorId });
  redirect("/vendor/profile?saved=1");
}

export default async function VendorProfile({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string }> }) {
  const user = await requireVendorUser();
  const sp = await searchParams;
  const v = await db.vendor.findUniqueOrThrow({ where: { id: user.vendorId }, select: { code: true, name: true, email: true, phone: true, country: true, categories: true, currency: true, paymentTermsDays: true, status: true } });
  const [open, billed] = await Promise.all([
    db.workOrder.count({ where: { vendorId: user.vendorId, status: { notIn: ["PAID", "CANCELLED", "REJECTED"] } } }),
    db.vendorBill.groupBy({ by: ["currency"], where: { vendorId: user.vendorId, status: { in: ["POSTED", "PAID"] } }, _sum: { amount: true } }),
  ]);
  return (
    <div className="space-y-5">
      <PageHeader title="Your company profile" subtitle="The details we hold for you. You can update how we reach you; ask us to change anything else." actions={<StatusBadge status={v.status} />} />
      {sp.saved && <Notice kind="ok">Your contact details were updated.</Notice>}
      {sp.error && <Notice kind="error">{sp.error}</Notice>}
      <section className="card grid max-w-2xl grid-cols-3 gap-y-2 text-sm">
        {([["Company", v.name], ["Vendor code", v.code], ["Country", v.country], ["Services", v.categories], ["Billing currency", v.currency], ["Payment terms", `${v.paymentTermsDays} days`], ["Open work orders", String(open)], ["Billed to date", billed.map((b) => formatMoney(b._sum.amount ?? 0, b.currency)).join(" · ") || "Nothing yet"]] as [string, string | null][]).map(([k, x]) => (
          <div key={k} className="contents"><span className="text-muted">{k}</span><span className="col-span-2">{x || <span className="text-muted">Not set</span>}</span></div>
        ))}
      </section>
      <form action={save} className="card max-w-2xl space-y-3">
        <h2 className="font-semibold">Contact details</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div><label className="label" htmlFor="vp-email">Email for orders and payments</label><input id="vp-email" name="email" type="email" defaultValue={v.email ?? ""} maxLength={200} className="input" /></div>
          <div><label className="label" htmlFor="vp-phone">Phone</label><input id="vp-phone" name="phone" type="tel" defaultValue={v.phone ?? ""} maxLength={40} className="input" /></div>
        </div>
        <SubmitButton>Save contact details</SubmitButton>
      </form>
    </div>
  );
}
