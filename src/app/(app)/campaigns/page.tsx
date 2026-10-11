import { requirePermission } from "@/lib/auth";
import { CAMPAIGN_STATUSES, CHANNELS, campaignStats } from "@/lib/crm";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { Badge, Empty, Notice, PageHeader } from "@/components/ui";
import { saveCampaignAction } from "../leads/crm-actions";

export const dynamic = "force-dynamic";
const TONE = { ACTIVE: "success", PLANNED: "primary", PAUSED: "warning", DONE: "neutral" } as const;

export default async function Campaigns({ searchParams }: { searchParams: Promise<{ error?: string; msg?: string; edit?: string }> }) {
  const user = await requirePermission("crm.view");
  const sp = await searchParams;
  const canManage = user.permissions.has("crm.view_all");
  const stats = await campaignStats(db, user.organizationId);
  const editing = stats.find((s) => s.campaign.id === sp.edit)?.campaign;
  return (
    <div className="space-y-6">
      <PageHeader title="Campaigns" subtitle="Where leads come from, what each source cost, and what it won. Tag a lead with its campaign on the lead page." />
      {sp.error && <Notice kind="error">{sp.error}</Notice>}
      {sp.msg && <Notice kind="ok">{sp.msg}</Notice>}
      {stats.length === 0 ? <Empty title="No campaigns yet">{canManage ? "Create the first one below." : "A manager can create campaigns."}</Empty> : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left"><tr><th className="py-2 pr-4">Campaign</th><th className="pr-4">Status</th><th className="pr-4 text-right">Leads</th><th className="pr-4 text-right">Won</th><th className="pr-4 text-right">Win rate</th><th className="pr-4 text-right">Budget</th><th className="pr-4 text-right">Cost per lead</th><th className="pr-4 text-right">Won value</th><th></th></tr></thead>
            <tbody>{stats.map((s) => (
              <tr key={s.campaign.id} className="border-t border-border">
                <td className="py-2 pr-4"><span className="font-medium">{s.campaign.name}</span><span className="block text-xs text-muted">{s.campaign.channel.toLowerCase().replace("_", " ")}{s.campaign.startDate && ` · ${s.campaign.startDate}${s.campaign.endDate ? ` to ${s.campaign.endDate}` : ""}`}</span></td>
                <td className="pr-4"><Badge tone={TONE[s.campaign.status as keyof typeof TONE] ?? "neutral"}>{s.campaign.status.toLowerCase()}</Badge></td>
                <td className="pr-4 text-right">{s.leads}</td><td className="pr-4 text-right">{s.won}</td><td className="pr-4 text-right">{s.winRate === null ? "" : `${s.winRate}%`}</td>
                <td className="pr-4 text-right">{s.campaign.budget ? formatMoney(s.campaign.budget, s.campaign.currency) : ""}</td>
                <td className="pr-4 text-right">{s.costPerLead ? formatMoney(s.costPerLead.toString(), s.campaign.currency) : ""}</td>
                <td className="pr-4 text-right">{formatMoney(s.wonValue.toString(), s.campaign.currency)}</td>
                <td>{canManage && <a className="text-xs underline" href={`/campaigns?edit=${s.campaign.id}`}>Edit</a>}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {canManage && (
        <form action={saveCampaignAction} className="card grid gap-3 sm:grid-cols-4">
          <h2 className="font-semibold sm:col-span-4">{editing ? `Edit ${editing.name}` : "New campaign"}</h2>
          <input type="hidden" name="id" value={editing?.id ?? ""} />
          <div className="sm:col-span-2"><label className="label" htmlFor="c-name">Name</label><input id="c-name" name="name" required maxLength={100} defaultValue={editing?.name} className="input" /></div>
          <div><label className="label" htmlFor="c-ch">Channel</label><select id="c-ch" name="channel" defaultValue={editing?.channel ?? "OTHER"} className="input">{CHANNELS.map((c) => <option key={c} value={c}>{c.toLowerCase().replace("_", " ")}</option>)}</select></div>
          <div><label className="label" htmlFor="c-st">Status</label><select id="c-st" name="status" defaultValue={editing?.status ?? "ACTIVE"} className="input">{CAMPAIGN_STATUSES.map((c) => <option key={c} value={c}>{c.toLowerCase()}</option>)}</select></div>
          <div><label className="label" htmlFor="c-bud">Budget</label><input id="c-bud" name="budget" inputMode="decimal" defaultValue={editing?.budget?.toString()} className="input" /></div>
          <div><label className="label" htmlFor="c-cur">Currency</label><select id="c-cur" name="currency" defaultValue={editing?.currency ?? "USD"} className="input">{["PKR", "USD", "AED", "GBP"].map((c) => <option key={c}>{c}</option>)}</select></div>
          <div><label className="label" htmlFor="c-s">Starts</label><input id="c-s" name="startDate" type="date" defaultValue={editing?.startDate ?? ""} className="input" /></div>
          <div><label className="label" htmlFor="c-e">Ends</label><input id="c-e" name="endDate" type="date" defaultValue={editing?.endDate ?? ""} className="input" /></div>
          <div className="sm:col-span-4"><label className="label" htmlFor="c-n">Notes</label><input id="c-n" name="notes" defaultValue={editing?.notes ?? ""} className="input" /></div>
          <div className="sm:col-span-4 flex gap-2"><button className="btn">{editing ? "Save changes" : "Create campaign"}</button>{editing && <a className="btn-ghost" href="/campaigns">Cancel</a>}</div>
        </form>
      )}
    </div>
  );
}
