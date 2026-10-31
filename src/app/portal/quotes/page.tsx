import { redirect } from "next/navigation";
import { audit, requireClientUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { SalesError, decideQuote, expireQuotes } from "@/lib/sales";
import { quoteDecided } from "@/lib/events";
import { Notice, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

async function decide(formData: FormData) {
  "use server";
  const user = await requireClientUser();
  const id = String(formData.get("id") ?? "");
  const decision = formData.get("decision") === "accept" ? "ACCEPT" : "DECLINE";
  try {
    await decideQuote(db, { organizationId: user.organizationId, quoteId: id, decision, byUserId: user.id, via: "PORTAL", clientId: user.clientId, note: String(formData.get("note") ?? ""), today: new Date().toISOString().slice(0, 10) });
    await audit(user, { action: `quote.${decision.toLowerCase()}`, entity: "Quote", entityId: id });
    await quoteDecided(db, { organizationId: user.organizationId, quoteId: id });
  } catch (e) {
    if (e instanceof SalesError) redirect(`/portal/quotes?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  redirect("/portal/quotes?done=1");
}

export default async function PortalQuotes({ searchParams }: { searchParams: Promise<{ error?: string; done?: string }> }) {
  const user = await requireClientUser();
  const sp = await searchParams;
  await expireQuotes(db, user.organizationId, new Date().toISOString().slice(0, 10));
  // Only quotations that were sent to the client, never drafts or cancelled ones
  const quotes = await db.quote.findMany({ where: { organizationId: user.organizationId, clientId: user.clientId, status: { notIn: ["DRAFT", "CANCELLED"] } }, orderBy: { createdAt: "desc" }, include: { lines: true } });
  return (
    <div className="space-y-4">
      <PageHeader title="Quotations" />
      {sp.done && <Notice kind="ok">Thank you. Your response has been recorded.</Notice>}
      {sp.error && <Notice kind="error">{sp.error}</Notice>}
      {quotes.length === 0 && <div className="card text-sm text-muted">No quotations yet.</div>}
      {quotes.map((q) => (
        <section key={q.id} className="card space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">{q.number} · {formatMoney(q.total, q.currency)} <span className="text-sm font-normal text-muted">{q.status === "INVOICED" ? "accepted" : q.status.toLowerCase()}</span></h2>
            <a className="btn-ghost" href={`/portal/quotes/${q.id}/pdf`} target="_blank" rel="noopener">Download PDF</a>
          </div>
          <ul className="text-sm">{q.lines.map((l) => <li key={l.id} className="flex justify-between border-t border-border py-1"><span>{l.description} × {l.quantity.toString()}</span><span>{formatMoney(l.amount, q.currency)}</span></li>)}</ul>
          {q.validUntil && <p className="text-xs text-muted">Valid until {q.validUntil}</p>}
          {q.status === "SENT" && (
            <form action={decide} className="flex flex-wrap items-end gap-2 pt-2">
              <input type="hidden" name="id" value={q.id} />
              <div className="grow"><label className="label" htmlFor={`n-${q.id}`}>Comment (optional)</label><input id={`n-${q.id}`} name="note" maxLength={500} className="input" /></div>
              <div><label className="label" htmlFor={`d-${q.id}`}>Your answer</label><select id={`d-${q.id}`} name="decision" className="input"><option value="accept">Accept</option><option value="decline">Decline</option></select></div>
              <button className="btn">Send answer</button>
            </form>
          )}
        </section>
      ))}
    </div>
  );
}
