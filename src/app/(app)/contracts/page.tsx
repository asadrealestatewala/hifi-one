import Link from "next/link";
import { redirect } from "next/navigation";
import { audit, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { SalesError, createContract, daysUntil, expireContracts } from "@/lib/sales";
import { Chips, Empty, NewButton, PageHeader, PanelForm, SearchBox, Stat, StatusBadge } from "@/components/ui";
import Drawer from "@/components/ui/Drawer";

export const dynamic = "force-dynamic";
const today = () => new Date().toISOString().slice(0, 10);

async function create(formData: FormData) {
  "use server";
  const user = await requirePermission("contracts.manage");
  let id: string;
  try {
    const c = await createContract(db, {
      organizationId: user.organizationId, clientId: String(formData.get("clientId") ?? ""), title: String(formData.get("title") ?? ""),
      startDate: String(formData.get("startDate") ?? "") || null, endDate: String(formData.get("endDate") ?? "") || null,
      renewalNoticeDays: Number(formData.get("renewalNoticeDays") || 30), currency: String(formData.get("currency") ?? "") || null,
      value: String(formData.get("value") ?? "").trim() || null, notes: String(formData.get("notes") ?? "").trim() || null, createdById: user.id,
    });
    id = c.id;
    await audit(user, { action: "contract.create", entity: "Contract", entityId: c.id, after: { title: c.title } });
  } catch (e) {
    if (e instanceof SalesError) redirect(`/contracts?new=1&error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  redirect(`/contracts/${id}`);
}

type SP = { error?: string; status?: string; q?: string; new?: string };

export default async function Contracts({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePermission("contracts.view");
  const sp = await searchParams;
  const org = user.organizationId;
  await expireContracts(db, org, today());
  const canManage = user.permissions.has("contracts.manage");
  const [all, clients] = await Promise.all([
    db.contract.findMany({ where: { organizationId: org }, orderBy: [{ endDate: "asc" }], include: { client: true } }),
    sp.new && canManage ? db.client.findMany({ where: { organizationId: org, active: true }, orderBy: { name: "asc" } }) : Promise.resolve([]),
  ]);
  const statuses = [...new Set(all.map((c) => c.status))];
  const status = statuses.includes(sp.status ?? "") ? sp.status! : "all";
  const q = sp.q?.trim().toLowerCase();
  const contracts = all.filter((c) => (status === "all" || c.status === status) && (!q || `${c.title} ${c.client.name}`.toLowerCase().includes(q)));
  const renewals = all.filter((c) => c.status === "ACTIVE" && c.endDate && daysUntil(c.endDate, today()) <= c.renewalNoticeDays).length;
  const href = (over: Record<string, string | undefined>) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries({ status: status === "all" ? undefined : status, q: sp.q?.trim(), ...over })) if (v) p.set(k, v); const t = p.toString(); return `/contracts${t ? `?${t}` : ""}`; };
  return (
    <div className="space-y-5">
      <PageHeader title="Contracts" subtitle="Agreements with clients, and when they need renewing." actions={canManage ? <NewButton href={href({ new: "1" })}>New contract</NewButton> : undefined} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Active" value={all.filter((c) => c.status === "ACTIVE").length} />
        <Stat label="Renewal due" value={renewals} hint="inside their reminder window" />
        <Stat label="All contracts" value={all.length} />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <SearchBox q={sp.q?.trim()} placeholder="Search title or client" hidden={{ status: status === "all" ? undefined : status }} />
        <Chips current={status} items={[{ key: "all", label: "All", count: all.length, href: href({ status: undefined }) }, ...statuses.map((s) => ({ key: s, label: s.toLowerCase().replace(/^./, (c) => c.toUpperCase()), count: all.filter((c) => c.status === s).length, href: href({ status: s }) }))]} />
      </div>
      {contracts.length === 0 ? <Empty title={q || status !== "all" ? "No contracts match" : "No contracts yet"}>{canManage ? "Create one with New contract." : "Contracts will appear here."}</Empty> : (
        <div className="card overflow-x-auto !p-0">
          <table className="w-full text-sm">
            <thead className="bg-hover/60 text-left text-xs text-muted"><tr><th className="px-4 py-2.5">Contract</th><th className="pr-4">Client</th><th className="pr-4">Status</th><th className="pr-4">Ends</th><th className="pr-4 text-right">Value</th></tr></thead>
            <tbody>
              {contracts.map((c) => {
                const left = c.status === "ACTIVE" && c.endDate ? daysUntil(c.endDate, today()) : null;
                return (
                  <tr key={c.id} className="border-t border-border transition hover:bg-hover/50">
                    <td className="px-4 py-3"><Link className="font-medium hover:underline" href={`/contracts/${c.id}`}>{c.title}</Link></td>
                    <td className="pr-4">{c.client.name}</td><td className="pr-4"><StatusBadge status={c.status} /></td>
                    <td className="pr-4 text-muted">{c.endDate ?? ""}{left !== null && left <= c.renewalNoticeDays && <span className="ml-2 text-xs font-semibold text-brand">renewal due in {left} day{left === 1 ? "" : "s"}</span>}</td>
                    <td className="pr-4 text-right tabular-nums">{c.value && c.currency ? formatMoney(c.value, c.currency) : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {canManage && sp.new && (
        <Drawer title="New contract" closeTo={href({ new: undefined })}>
          <PanelForm action={create} closeTo={href({ new: undefined })} submit="Save contract" error={sp.error} hint="Saved as a draft. Attach the signed document on the next page.">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2"><label className="label" htmlFor="title">Title</label><input id="title" name="title" required maxLength={160} className="input" placeholder="e.g. Master services agreement" /></div>
              <div className="sm:col-span-2"><label className="label" htmlFor="clientId">Client</label>
                <select id="clientId" name="clientId" required className="input"><option value="">Choose…</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
              <div><label className="label" htmlFor="startDate">Starts</label><input id="startDate" name="startDate" type="date" className="input" /></div>
              <div><label className="label" htmlFor="endDate">Ends</label><input id="endDate" name="endDate" type="date" className="input" /></div>
              <div><label className="label" htmlFor="renewalNoticeDays">Renewal reminder (days before)</label><input id="renewalNoticeDays" name="renewalNoticeDays" defaultValue="30" inputMode="numeric" className="input" /></div>
              <div className="grid grid-cols-[5rem_1fr] gap-2">
                <div><label className="label" htmlFor="currency">Currency</label><select id="currency" name="currency" className="input" defaultValue="USD">{["PKR", "USD", "AED", "GBP"].map((c) => <option key={c}>{c}</option>)}</select></div>
                <div><label className="label" htmlFor="value">Value (optional)</label><input id="value" name="value" inputMode="decimal" className="input" /></div>
              </div>
              <div className="sm:col-span-2"><label className="label" htmlFor="notes">Notes</label><textarea id="notes" name="notes" rows={2} className="input" /></div>
            </div>
          </PanelForm>
        </Drawer>
      )}
    </div>
  );
}
