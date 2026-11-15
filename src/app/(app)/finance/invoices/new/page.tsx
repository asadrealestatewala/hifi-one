import { requirePermission } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import InvoiceEditor from "../InvoiceEditor";
import { saveInvoiceAction } from "../actions";
import { loadEditorData } from "../editor-data";

export const dynamic = "force-dynamic";

// New invoice: the form and a live preview side by side. It is saved as a draft and only posts when issued.
export default async function NewInvoicePage({ searchParams }: { searchParams: Promise<{ error?: string; client?: string }> }) {
  const user = await requirePermission("finance.post");
  const sp = await searchParams;
  const data = await loadEditorData(user.organizationId);
  return (
    <div className="space-y-4">
      <PageHeader back={{ href: "/finance/invoices", label: "Invoices" }} title="New invoice" subtitle="Fill in the form; the preview shows the invoice as your client will see it." />
      <InvoiceEditor data={data} action={saveInvoiceAction} error={sp.error} defaultClientId={sp.client} cancelHref="/finance/invoices" />
    </div>
  );
}
