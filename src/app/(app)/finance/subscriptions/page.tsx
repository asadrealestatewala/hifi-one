import Link from "next/link";
import { redirect } from "next/navigation";
import { audit, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { SalesError, createSubscription, generateDueInvoices, setSubscriptionStatus } from "@/lib/sales";
import { Chips, Empty, NewButton, Notice, PageHeader, PanelForm, SearchBox, Stat, StatusBadge } from "@/components/ui";
import Drawer from "@/components/ui/Drawer";

export const dynamic = "force-dynamic";
const today = () => new Date().toISOString().slice(0, 10);
const bounce = (kind: "error" | "msg", m: string) => redirect(`/finance/subscriptions?${kind}=${encodeURIComponent(m)}`);

async function create(formData: FormData) {
  "use server";
  const user = await requirePermission("subscriptions.manage");
  try {
    const s = await createSubscription(db, {
      organizationId: user.organizationId, clientId: String(formData.get("clientId") ?? ""), name: String(formData.get("name") ?? ""), currency: String(formData.get("currency") ?? ""),
      amount: String(formData.get("amount") ?? "").trim(), taxRate: String(formData.get("taxRate") || "0"), interval: String(formData.get("interval") ?? ""),
      startDate: String(formData.get("startDate") ?? ""), endDate: String(formData.get("endDate") ?? "") || null, createdById: user.id,
    });
    await audit(user, { action: "subscription.create", entity: "Subscription", entityId: s.id, after: { name: s.name, amount: s.amount.toString(), interval: s.interval } });
  } catch (e) {
    if (e instanceof SalesError) redirect(`/finance/subscriptions?new=1&error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  bounce("msg", "Subscription created.");
}

async function change(formData: FormData) {
  "use server";
  const user = await requirePermission("subscriptions.manage");
  const op = String(formData.get("op") ?? "").toUpperCase();
  if (!["PAUSE", "RESUME", "CANCEL"].includes(op)) return bounce("error", "Unknown action.");
  const id = String(formData.get("id") ?? "");
  try {
    await setSubscriptionStatus(db, { organizationId: user.organizationId, subscriptionId: id, action: op as "PAUSE" | "RESUME" | "CANCEL", today: today() });
    await audit(user, { action: `subscription.${op.toLowerCase()}`, entity: "Subscription", entityId: id });
  } catch (e) {
    if (e instanceof SalesError) return bounce("error", e.message);
    throw e;
  }
  bounce("msg", "Updated.");
}

async function generate() {
  "use server";
  const user = await requirePermission("subscriptions.manage");
  const created = await generateDueInvoices(db, { organizationId: user.organizationId, today: today(), actorId: user.id });
  await audit(user, { action: "subscription.generate", entity: "Subscription", after: { invoices: created.length } });
  bounce("msg", created.length === 0 ? "Nothing is due." : `${created.length} draft invoice${created.length === 1 ? "" : "s"} created. Review and issue them under Invoices.`);
}

type SP = { error?: string; msg?: string; status?: string; q?: string; new?: string };

export default async function Subscriptions({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePermission("finance.view");
  const sp = await searchParams;
  const org = user.organizationId;
  const canManage = user.permissions.has("subscriptions.manage");
  const [all, clients, dueCount, rates] = await Promise.all([
    db.subscription.findMany({ where: { organizationId: org }, orderBy: [{ status: "asc" }, { nextBillingDate: "asc" }], include: { client: true, _count: { select: { invoices: true } } } }),
    sp.new && canManage ? db.client.findMany({ where: { organizationId: org, active: true }, orderBy: { name: "asc" } }) : Promise.resolve([]),
    db.subscription.count({ where: { organizationId: org, status: "ACTIVE", nextBillingDate: { lte: today() } } }),
    sp.new && canManage ? db.taxRate.findMany({ where: { organizationId: org, active: true }, orderBy: { name: "asc" } }) : Promise.resolve([]),
  ]);
  const statuses = [...new Set(all.map((x) => x.status))];
  const status = statuses.includes(sp.status ?? "") ? sp.status! : "all";
  const q = sp.q?.trim().toLowerCase();
  const subs = all.filter((x) => (status === "all" || x.status === status) && (!q || `${x.name} ${x.client.name}`.toLowerCase().includes(q)));
  const href = (over: Record<string, string | undefined>) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries({ status: status === "all" ? undefined : status, q: sp.q?.trim(), ...over })) if (v) p.set(k, v); const t = p.toString(); return `/finance/subscriptions${t ? `?${t}` : ""}`; };
  const btn = (id: string, op: string, label: string) => (
    <form action={change} className="inline"><input type="hidden" name="id" value={id} /><input type="hidden" name="op" value={op} /><button className="text-sm text-primary hover:underline">{label}</button></form>
  );
  return (
    <div className="space-y-5">
      <PageHeader title="Subscriptions" subtitle={<>Each due period creates one <strong>draft</strong> invoice for review. Nothing is issued or posted automatically, and running it again never bills the same period twice.</>}
        actions={canManage ? <>
          <form action={generate} className="flex items-center gap-2"><span className="text-sm text-muted">{dueCount} due now</span><button className="btn-ghost">Create due invoices</button></form>
          <NewButton href={href({ new: "1" })}>New subscription</NewButton>
        </> : undefined} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Active" value={all.filter((x) => x.status === "ACTIVE").length} />
        <Stat label="Due for billing" value={dueCount} />
        <Stat label="Paused" value={all.filter((x) => x.status === "PAUSED").length} />
      </div>
      {sp.msg && <Notice kind="ok">{sp.msg}</Notice>}
      {sp.error && !sp.new && <Notice kind="error">{sp.error}</Notice>}
      <div className="flex flex-wrap items-center gap-3">
        <SearchBox q={sp.q?.trim()} placeholder="Search name or client" hidden={{ status: status === "all" ? undefined : status }} />
        <Chips current={status} items={[{ key: "all", label: "All", count: all.length, href: href({ status: undefined }) }, ...statuses.map((x) => ({ key: x, label: x.toLowerCase().replace(/^./, (c) => c.toUpperCase()), count: all.filter((y) => y.status === x).length, href: href({ status: x }) }))]} />
      </div>
      {subs.length === 0 ? <Empty title={q || status !== "all" ? "No subscriptions match" : "No subscriptions yet"}>{canManage ? "Create one with New subscription." : "Subscriptions will appear here."}</Empty> : (
        <div className="card overflow-x-auto !p-0">
          <table className="w-full text-sm">
            <thead className="bg-hover/60 text-left text-xs text-muted"><tr><th className="px-4 py-2.5">Subscription</th><th className="pr-4">Client</th><th className="pr-4 text-right">Amount</th><th className="pr-4">Status</th><th className="pr-4">Next billing</th><th className="pr-4">Invoices</th><th /></tr></thead>
            <tbody>
              {subs.map((x) => (
                <tr key={x.id} className="border-t border-border transition hover:bg-hover/50">
                  <td className="px-4 py-2.5">{x.name}<span className="block text-xs text-muted">{x.interval.toLowerCase()}, from {x.startDate}{x.endDate ? ` to ${x.endDate}` : ""}</span></td>
                  <td className="pr-4"><Link className="hover:underline" href={`/clients/${x.clientId}`}>{x.client.name}</Link></td>
                  <td className="pr-4 text-right tabular-nums">{formatMoney(x.amount, x.currency)}{Number(x.taxRate) > 0 && <span className="block text-xs text-muted">+ {x.taxRate.toString()}% tax</span>}</td>
                  <td className="pr-4"><StatusBadge status={x.status} /></td><td className="pr-4 text-muted">{x.nextBillingDate ?? ""}</td><td className="pr-4">{x._count.invoices}</td>
                  <td className="space-x-3 whitespace-nowrap pr-4">
                    {canManage && x.status === "ACTIVE" && btn(x.id, "PAUSE", "Pause")}
                    {canManage && x.status === "PAUSED" && btn(x.id, "RESUME", "Resume")}
                    {canManage && (x.status === "ACTIVE" || x.status === "PAUSED") && btn(x.id, "CANCEL", "Cancel")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {canManage && sp.new && (
        <Drawer title="New subscription" closeTo={href({ new: undefined })}>
          <PanelForm action={create} closeTo={href({ new: undefined })} submit="Create subscription" error={sp.error}>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2"><label className="label" htmlFor="name">Name</label><input id="name" name="name" required maxLength={120} className="input" placeholder="e.g. Monthly social media management" /></div>
              <div className="sm:col-span-2"><label className="label" htmlFor="clientId">Client</label>
                <select id="clientId" name="clientId" required className="input"><option value="">Choose…</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
              <div><label className="label" htmlFor="currency">Currency</label><select id="currency" name="currency" className="input" defaultValue="USD">{["PKR", "USD", "AED", "GBP"].map((c) => <option key={c}>{c}</option>)}</select></div>
              <div><label className="label" htmlFor="amount">Amount each period</label><input id="amount" name="amount" required inputMode="decimal" className="input" /></div>
              <div><label className="label" htmlFor="taxRate">Tax rate (%)</label><input id="taxRate" name="taxRate" defaultValue="0" list="taxrates" className="input" /><datalist id="taxrates">{rates.map((r) => <option key={r.id} value={r.ratePercent.toString()}>{r.name}</option>)}</datalist></div>
              <div><label className="label" htmlFor="interval">Billed</label><select id="interval" name="interval" className="input"><option value="MONTHLY">Monthly</option><option value="QUARTERLY">Quarterly</option><option value="ANNUAL">Annually</option></select></div>
              <div><label className="label" htmlFor="startDate">First billing date</label><input id="startDate" name="startDate" type="date" required defaultValue={today()} className="input" /></div>
              <div><label className="label" htmlFor="endDate">Ends (optional)</label><input id="endDate" name="endDate" type="date" className="input" /></div>
            </div>
          </PanelForm>
        </Drawer>
      )}
    </div>
  );
}
