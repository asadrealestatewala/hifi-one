import { notFound, redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import QuoteEditor from "../../QuoteEditor";
import { saveQuoteAction } from "../../actions";
import { loadPlanOptions } from "../../plan-options";
import { loadEditorData } from "@/lib/doc-editor-data";

export const dynamic = "force-dynamic";

// Editing is for drafts only; once sent, the client may already be reading it.
export default async function EditQuotePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const user = await requirePermission("quotes.manage");
  const { id } = await params;
  const sp = await searchParams;
  const q = await db.quote.findFirst({ where: { id, organizationId: user.organizationId }, include: { lines: { orderBy: { id: "asc" } } } });
  if (!q) notFound();
  if (q.status !== "DRAFT") redirect(`/quotes/${id}?error=${encodeURIComponent("Only a draft can be edited. Cancel this one and make a new version instead.")}`);
  const [data, plans] = await Promise.all([loadEditorData(user.organizationId, "QUOTE"), loadPlanOptions(user.organizationId)]);
  // Keep the client on the list even if it was deactivated after the draft was made
  if (!data.clients.some((c) => c.id === q.clientId)) {
    const c = await db.client.findFirst({ where: { id: q.clientId, organizationId: user.organizationId }, select: { id: true, name: true, currency: true, billingAddress: true, taxId: true, paymentTermsDays: true } });
    if (c) data.clients.unshift(c);
  }
  const initial = {
    id: q.id, number: q.number, clientId: q.clientId, currency: q.currency, taxRate: q.taxRate.toString(), validUntil: q.validUntil ?? "", notes: q.notes ?? "", terms: q.terms ?? "",
    templateKey: q.templateKey, title: q.title ?? "", introduction: q.introduction ?? "", scope: q.scope ?? "", timeline: q.timeline ?? "",
    // Saved plan lines go back as they are (keep), so saving again does not re-price them or add the setup fee twice
    lines: q.lines.map((l) => ({ desc: l.description, qty: l.quantity.toString(), price: l.unitPrice.toString(), keep: l.planId ? `${l.planId}:${l.planVersion ?? ""}` : undefined })),
  };
  return (
    <div className="space-y-4">
      <PageHeader back={{ href: `/quotes/${id}`, label: q.number }} title={`Edit draft ${q.number}`} subtitle="Changes show in the preview as you type." />
      <QuoteEditor data={data} plans={plans} action={saveQuoteAction} initial={initial} error={sp.error} cancelHref={`/quotes/${id}`} />
    </div>
  );
}
