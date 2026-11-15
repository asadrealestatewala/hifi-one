import { requireClientUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { portalContracts } from "@/lib/sales";
import FilesPanel from "@/components/FilesPanel";
import { PageHeader, StatusBadge } from "@/components/ui";

export const dynamic = "force-dynamic";

// The client's agreements: contracts and scopes of work that staff chose to show here, with their signed files (read only).
export default async function PortalAgreements() {
  const user = await requireClientUser();
  const contracts = await portalContracts(db, user.clientId);
  return (
    <div className="space-y-4">
      <PageHeader title="Agreements" subtitle="Your signed agreements and scopes of work with us." />
      {contracts.length === 0 && <div className="card text-sm text-muted">No agreements shared yet. Your account manager will add them here.</div>}
      {contracts.map((c) => (
        <section key={c.id} className="space-y-2">
          <div className="card space-y-1 text-sm">
            <h2 className="flex flex-wrap items-center gap-2 text-base font-semibold">{c.title}<StatusBadge status={c.status} /></h2>
            <p className="text-muted">Term: {c.startDate ?? "not set"} to {c.endDate ?? "open ended"}{c.value && c.currency ? ` · ${formatMoney(c.value, c.currency)}` : ""}</p>
          </div>
          <FilesPanel user={user} ownerType="CONTRACT" ownerId={c.id} returnTo="/portal/agreements" title="Documents" />
        </section>
      ))}
    </div>
  );
}
