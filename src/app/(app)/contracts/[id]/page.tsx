import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { audit, requirePermission } from "@/lib/auth";
import FilesPanel from "@/components/FilesPanel";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
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
      <h1 className="text-2xl font-bold">{c.title} <span className="text-base font-normal text-muted">{c.status.toLowerCase()}</span></h1>
      {error && <p role="alert" className="text-sm text-brand bg-brand/10 rounded-lg px-3 py-2">{error}</p>}
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
