import { requirePermission } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import QuoteEditor from "../QuoteEditor";
import { saveQuoteAction } from "../actions";
import { loadPlanOptions } from "../plan-options";
import { loadEditorData } from "@/lib/doc-editor-data";

export const dynamic = "force-dynamic";

// New proposal or quotation: the form and a live preview side by side. It is saved as a draft until sent.
export default async function NewQuotePage({ searchParams }: { searchParams: Promise<{ error?: string; client?: string }> }) {
  const user = await requirePermission("quotes.manage");
  const sp = await searchParams;
  const [data, plans] = await Promise.all([loadEditorData(user.organizationId, "QUOTE"), loadPlanOptions(user.organizationId)]);
  return (
    <div className="space-y-4">
      <PageHeader back={{ href: "/quotes", label: "Proposals & quotations" }} title="New proposal or quotation" subtitle="Fill in the form; the preview shows the document as your client will see it." />
      <QuoteEditor data={data} plans={plans} action={saveQuoteAction} error={sp.error} defaultClientId={sp.client} cancelHref="/quotes" />
    </div>
  );
}
