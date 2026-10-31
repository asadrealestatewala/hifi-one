import { redirect } from "next/navigation";
import { requireVendorUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { VendorError, apply } from "@/lib/vendors";
import { formatMoney } from "@/lib/money";
import { Notice, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

async function submitApplication(formData: FormData) {
  "use server";
  const user = await requireVendorUser();
  try {
    await apply(db, {
      vendorId: user.vendorId, opportunityId: String(formData.get("opportunityId")), quote: String(formData.get("quote") ?? ""),
      proposal: String(formData.get("proposal") ?? ""), today: new Date().toISOString().slice(0, 10),
    });
    await db.auditLog.create({ data: { organizationId: user.organizationId, actorId: user.id, action: "vendor.apply", entity: "VendorOpportunity", entityId: String(formData.get("opportunityId")) } });
  } catch (e) {
    if (e instanceof VendorError) redirect(`/vendor?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  redirect("/vendor?ok=1");
}

export default async function VendorHome({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  const user = await requireVendorUser();
  const { error, ok } = await searchParams;
  const vendor = await db.vendor.findUniqueOrThrow({ where: { id: user.vendorId } });
  // Only open opportunities are shown, and only this vendor's own applications. Other vendors' quotes are never selected.
  const [opps, mine] = await Promise.all([
    vendor.status === "APPROVED"
      ? db.vendorOpportunity.findMany({
          where: { organizationId: vendor.organizationId, status: "OPEN" }, orderBy: { createdAt: "desc" },
          select: { id: true, title: true, scope: true, skills: true, budgetMin: true, budgetMax: true, currency: true, deadline: true },
        })
      : Promise.resolve([]),
    db.vendorApplication.findMany({ where: { vendorId: vendor.id }, include: { opportunity: { select: { title: true, currency: true } } }, orderBy: { createdAt: "desc" } }),
  ]);
  const applied = new Set(mine.map((a) => a.opportunityId));
  return (
    <div className="space-y-6">
      <PageHeader title="Opportunities" />
      {vendor.status !== "APPROVED" && <p className="card text-sm">Your vendor account is awaiting approval. You will be able to apply once it is approved.</p>}
      {ok && <Notice kind="ok">Application submitted. Applying does not guarantee an award; you will see the decision here.</Notice>}
      {error && <Notice kind="error">{error}</Notice>}
      {opps.length === 0 && vendor.status === "APPROVED" && <div className="card text-sm text-muted">No open opportunities right now.</div>}
      {opps.map((o) => (
        <article key={o.id} className="card space-y-2">
          <div className="flex justify-between gap-2"><h2 className="font-semibold">{o.title}</h2><span className="text-xs text-muted">{o.deadline && `Apply by ${o.deadline}`}</span></div>
          <p className="text-sm">{o.scope}</p>
          <p className="text-xs text-muted">{o.skills && `Skills: ${o.skills}. `}{o.budgetMax && `Budget ${o.budgetMin ? formatMoney(o.budgetMin, o.currency) + " to " : "up to "}${formatMoney(o.budgetMax, o.currency)}.`}</p>
          {applied.has(o.id) ? <p className="text-sm font-medium">You have applied.</p> : (
            <form action={submitApplication} className="flex flex-wrap items-end gap-2 border-t border-border pt-2">
              <input type="hidden" name="opportunityId" value={o.id} />
              <div><label className="label" htmlFor={`q${o.id}`}>Your quote ({o.currency})</label><input id={`q${o.id}`} name="quote" required inputMode="decimal" className="input !w-36" /></div>
              <div className="flex-1 min-w-48"><label className="label" htmlFor={`p${o.id}`}>Proposal</label><input id={`p${o.id}`} name="proposal" className="input" /></div>
              <button className="btn">Apply</button>
            </form>
          )}
        </article>
      ))}
      <section className="card">
        <h2 className="font-semibold mb-2">My applications</h2>
        {mine.length === 0 ? <p className="text-sm text-muted">None yet.</p> : (
          <ul className="text-sm">{mine.map((a) => <li key={a.id} className="flex justify-between border-t border-border py-1.5 first:border-0"><span>{a.opportunity.title}</span><span>{formatMoney(a.quoteAmount, a.opportunity.currency)} · {a.status.toLowerCase()}</span></li>)}</ul>
        )}
      </section>
    </div>
  );
}
