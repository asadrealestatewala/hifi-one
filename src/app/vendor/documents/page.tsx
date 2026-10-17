import { requireVendorUser } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import FilesPanel from "@/components/FilesPanel";

export const dynamic = "force-dynamic";

// The vendor's own compliance documents. Only this vendor's people (and our staff with vendor access) can open them, and every
// upload is checked and recorded like any other file. Expiry dates trigger reminders to our team before they lapse.
export default async function VendorDocuments({ searchParams }: { searchParams: Promise<{ fileError?: string; fileOk?: string }> }) {
  const user = await requireVendorUser();
  const sp = await searchParams;
  return (
    <div className="space-y-5">
      <PageHeader title="Your documents" subtitle="Registration, tax certificate, insurance and anything else we need on file. Add an expiry date so we can remind both of us before it lapses." />
      <FilesPanel user={user} ownerType="VENDOR_DOC" ownerId={user.vendorId} returnTo="/vendor/documents" title="Documents on file" withCategory withExpiry flash={{ fileError: sp.fileError, fileOk: sp.fileOk }} />
    </div>
  );
}
