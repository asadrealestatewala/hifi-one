import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { audit, requirePermission } from "@/lib/auth";
import FilesPanel from "@/components/FilesPanel";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { Notice, StatusBadge } from "@/components/ui";
import { SalesError, daysUntil, expireContracts, setContractStatus } from "@/lib/sales";

export const dynamic = "force-dynamic";

async function setStatus(formData: FormData) {
  "use server";
  const user = await requirePermission("contracts.manage");
  const id = String(formData.get("id") ?? "");
  const to = String(formData.get("to") ?? "");
  try {
    await setContractStatus(db, { organizationId: user.organizationId, contractId: id, to });
    await audit(user, { action: "contract.status", entity: "Contract", entityId: id, after: { status: to } });
  } catch (e) {
    if (e instanceof SalesError) redirect(`/contracts/${id}?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  redirect(`/contracts/${id}`);
}

const NEXT: Record<string, [string, string][]> = {
  DRAFT: [["ACTIVE", "Mark as active (signed)"], ["TERMINATED", "Terminate"]],
  ACTIVE: [["TERMINATED", "Terminate"]],
  EXPIRED: [["ACTIVE", "Renewed: mark active again"]],
  TERMINATED: [],
};

export default async function ContractDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; fileError?: string; fileOk?: string }> }) {
  const user = await requirePermission("contracts.view");
  const { id } = await params;
  const { error, fileError, fileOk } = await searchParams;
  const today = new Date().toISOString().slice(0, 10);
  await expireContracts(db, user.organizationId, today);
  const c = await db.contract.findFirst({ where: { id, organizationId: user.organizationId }, include: { client: true } });
  if (!c) notFound();
  const canManage = user.permissions.has("contracts.manage");
  const left = c.status === "ACTIVE" && c.endDate ? daysUntil(c.endDate, today) : null;
  return (
    <div className="space-y-4 max-w-3xl">
      <Link href="/contracts" className="text-sm text-muted hover:underline">← Contracts</Link>
      <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold tracking-tight">{c.title}<StatusBadge status={c.status} /></h1>
      {error && <Notice kind="error">{error}</Notice>}
      {c.startDate && c.endDate && c.status === "ACTIVE" && (() => {
        const total = Math.max(1, daysUntil(c.endDate, c.startDate)), used = Math.min(total, Math.max(0, total - (left ?? 0)));
        const pct = Math.round((used / total) * 100);
        return <div className="card space-y-1.5"><div className="flex justify-between text-xs text-muted"><span>{c.startDate}</span><span>{pct}% of the term used</span><span>{c.endDate}</span></div><div className="h-2 overflow-hidden rounded-full bg-hover" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><div className={`h-full rounded-full ${left !== null && left <= c.renewalNoticeDays ? "bg-brand" : "bg-primary"}`} style={{ width: `${pct}%` }} /></div></div>;
      })()}
      <section className="card space-y-1 text-sm">
        <p>Client: <Link className="underline" href={`/clients/${c.clientId}`}>{c.client.name}</Link></p>
        <p>Term: {c.startDate ?? "not set"} to {c.endDate ?? "open ended"}</p>
        {c.value && c.currency && <p>Value: {formatMoney(c.value, c.currency)}</p>}
        <p>Renewal reminder: {c.renewalNoticeDays} days before the end date</p>
        {left !== null && left <= c.renewalNoticeDays && <p className="font-semibold text-brand">Renewal due: this contract ends in {left} day{left === 1 ? "" : "s"}.</p>}
        {c.notes && <p className="whitespace-pre-line text-muted">{c.notes}</p>}
      </section>
      {canManage && NEXT[c.status]?.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {NEXT[c.status].map(([to, label]) => (
            <form key={to} action={setStatus}><input type="hidden" name="id" value={c.id} /><input type="hidden" name="to" value={to} /><button className={to === "TERMINATED" ? "btn-ghost" : "btn"}>{label}</button></form>
          ))}
        </div>
      )}
      <FilesPanel user={user} ownerType="CONTRACT" ownerId={c.id} returnTo={`/contracts/${c.id}`} title="Signed contract and attachments" withCategory flash={{ fileError, fileOk }} />
    </div>
  );
}
