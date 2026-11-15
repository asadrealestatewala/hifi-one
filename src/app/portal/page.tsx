import Link from "next/link";
import { requireClientUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { portalInvoices, portalManager, portalPayments, portalSupport, portalProjects } from "@/lib/portal";
import { Notice, PageHeader } from "@/components/ui";
import { redirect } from "next/navigation";
import ReviewAreasField, { AreaList, readAreaRatings } from "@/components/ReviewAreasField";
import { ClientReviewError, openPortalReviews, reviewAreasFor, submitClientReview, weekLabel } from "@/lib/client-reviews";

async function sendReview(formData: FormData): Promise<void> {
  "use server";
  const user = await requireClientUser();
  try {
    await submitClientReview(db, { requestId: String(formData.get("requestId") ?? ""), clientId: user.clientId, userId: user.id, rating: Number(formData.get("rating") || 0), review: String(formData.get("review") ?? ""), areaRatings: readAreaRatings(formData) });
  } catch (e) {
    if (e instanceof ClientReviewError) redirect(`/portal?reviewError=${encodeURIComponent(e.message)}#reviews`);
    throw e;
  }
  redirect("/portal?reviewed=1#reviews");
}

export const dynamic = "force-dynamic";

const LABEL: Record<string, string> = { TODO: "To do", IN_PROGRESS: "In progress", REVIEW: "In review", DONE: "Done" };

export default async function PortalHome({ searchParams }: { searchParams: Promise<{ reviewError?: string; reviewed?: string }> }) {
  const user = await requireClientUser();
  const sp = await searchParams;
  const [openReviews, myReviews, reviewClient] = await Promise.all([openPortalReviews(db, user.clientId), db.clientReview.findMany({ where: { clientId: user.clientId, source: { in: ["CLIENT_LINK", "PORTAL"] } }, orderBy: { weekStart: "desc" }, take: 8, select: { id: true, weekStart: true, rating: true, review: true, areas: true } }), db.client.findUniqueOrThrow({ where: { id: user.clientId }, select: { reviewAreas: true, clientType: true } })]);
  const [invoices, projects, payments, manager, support] = await Promise.all([portalInvoices(db, user.clientId), portalProjects(db, user.clientId), portalPayments(db, user.clientId), portalManager(db, user.clientId), portalSupport(db, user.clientId)]);
  const owed = new Map<string, number>();
  for (const i of invoices) owed.set(i.currency, (owed.get(i.currency) ?? 0) + Number(i.total.sub(i.amountPaid).sub(i.creditedAmount)));
  return (
    <div className="space-y-6">
      <PageHeader title="Your account" />
      {manager && <p className="text-sm text-muted">Your project manager: <strong className="text-foreground">{manager.name}</strong>{manager.employeeNo && ` (ID ${manager.employeeNo})`}</p>}
      {support && <p className="text-sm text-muted">Your {support.dedicated ? "support manager" : "support contact"}: <strong className="text-foreground">{support.name}</strong>{support.employeeNo && ` (ID ${support.employeeNo})`}. Tutorials and support calls appear under Meetings.</p>}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="card"><p className="text-xs font-semibold text-muted">Outstanding</p>
          {owed.size === 0 ? <p className="text-2xl font-bold">Nothing due</p> : [...owed].map(([c, v]) => <p key={c} className="text-2xl font-bold">{formatMoney(v, c)}</p>)}
        </div>
        <div className="card"><p className="text-xs font-semibold text-muted">Invoices</p><p className="text-2xl font-bold">{invoices.length}</p></div>
        <div className="card"><p className="text-xs font-semibold text-muted">Active projects</p><p className="text-2xl font-bold">{projects.filter((p) => p.status === "ACTIVE").length}</p></div>
      </div>

      {(openReviews.length > 0 || myReviews.length > 0 || sp.reviewed || sp.reviewError) && (
        <section id="reviews" className="card space-y-3">
          <h2 className="font-semibold">Weekly reviews</h2>
          {sp.reviewed && <Notice kind="ok">Thank you. Your review was sent to your project manager and our management team.</Notice>}
          {sp.reviewError && <Notice kind="error">{sp.reviewError}</Notice>}
          {openReviews.slice(0, 1).map((r) => (
            <form key={r.id} action={sendReview} className="space-y-3 rounded-lg border border-border p-3">
              <input type="hidden" name="requestId" value={r.id} />
              <p className="text-sm font-medium">How was the week of {r.week}?</p>
              <ReviewAreasField areas={reviewAreasFor(reviewClient)} idPrefix={`rv-${r.id}`} />
              <button className="btn">Send review</button>
            </form>
          ))}
          {openReviews.length > 1 && <p className="text-xs text-muted">{openReviews.length - 1} more week{openReviews.length === 2 ? "" : "s"} waiting for your review after this one.</p>}
          {myReviews.length > 0 && <ul className="divide-y divide-border text-sm">{myReviews.map((r) => <li key={r.id} className="py-2"><div className="flex flex-wrap justify-between gap-2"><span className="font-medium">Week of {weekLabel(r.weekStart)}</span><span aria-label={`${r.rating} of 5`}>{"★".repeat(r.rating)}{"☆".repeat(5 - r.rating)}</span></div><AreaList areas={r.areas} /><p className="whitespace-pre-line text-muted">{r.review}</p></li>)}</ul>}
        </section>
      )}

      <section className="card overflow-x-auto">
        <h2 className="font-semibold mb-2">Invoices</h2>
        {invoices.length === 0 ? <p className="text-sm text-muted">No invoices yet.</p> : (
          <table className="w-full text-sm">
            <thead className="bg-hover/60 text-left text-xs text-muted"><tr><th className="py-2 pr-4">Number</th><th className="pr-4">Due</th><th className="pr-4">Status</th><th className="pr-4 text-right">Total</th><th className="text-right">Balance</th></tr></thead>
            <tbody>
              {invoices.map((i) => (
                <tr key={i.id} className="border-t border-border transition hover:bg-hover/50">
                  <td className="py-2 pr-4"><Link className="underline" href={`/portal/invoices/${i.id}`}>{i.number}</Link></td>
                  <td className="pr-4">{i.dueDate?.toLocaleDateString()}</td>
                  <td className="pr-4">{i.status.replace("_", " ")}</td>
                  <td className="pr-4 text-right">{formatMoney(i.total, i.currency)}</td>
                  <td className="text-right">{formatMoney(i.total.sub(i.amountPaid).sub(i.creditedAmount), i.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {payments.length > 0 && (
        <section className="card">
          <h2 className="font-semibold mb-2">Payments and receipts</h2>
          <ul className="text-sm">{payments.map((p) => <li key={p.id} className="flex justify-between border-t border-border py-1.5 first:border-0"><a className="underline" href={`/portal/receipts/${p.id}/pdf`} target="_blank" rel="noopener">{p.number}</a><span>{p.date.toLocaleDateString()} · {formatMoney(p.amount, p.currency)}</span></li>)}</ul>
        </section>
      )}

      <section className="space-y-3">
        <div className="flex items-center justify-between"><h2 className="font-semibold">Projects</h2><Link href="/portal/projects" className="text-sm text-primary hover:underline">Open projects and message the team</Link></div>
        {projects.length === 0 && <div className="card text-sm text-muted">No projects yet.</div>}
        {projects.map((p) => (
          <article key={p.id} className="card space-y-2">
            <div className="flex justify-between"><h3 className="font-semibold">{p.name}</h3><span className="text-sm text-muted">{p.status.replace("_", " ")} · {p.progress}%</span></div>
            <div className="h-2 rounded-full bg-border overflow-hidden"><div className="h-full bg-brand" style={{ width: `${p.progress}%` }} /></div>
            {p.tasks.length > 0 && (
              <ul className="text-sm">
                {p.tasks.map((t, i) => <li key={i} className="flex justify-between border-t border-border py-1"><span>{t.title}</span><span className="text-muted">{LABEL[t.status] ?? t.status}</span></li>)}
              </ul>
            )}
          </article>
        ))}
      </section>
    </div>
  );
}
