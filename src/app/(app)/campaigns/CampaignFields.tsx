import { CAMPAIGN_STATUSES, CHANNELS } from "@/lib/crm";

type Values = { name?: string; categoryId?: string | null; description?: string | null; objectives?: string | null; status?: string; channel?: string; budget?: string | null; currency?: string; startDate?: string | null; endDate?: string | null; ownerId?: string | null; notes?: string | null };

// Shared by the New panel and the detail page's edit form
export default function CampaignFields({ categories, staff, v = {} }: { categories: { id: string; name: string }[]; staff: { id: string; name: string }[]; v?: Values }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2"><label className="label" htmlFor="c-name">Name <span className="text-brand">*</span></label><input id="c-name" name="name" required maxLength={100} defaultValue={v.name} className="input" /></div>
      <div><label className="label" htmlFor="c-cat">Category</label><select id="c-cat" name="categoryId" defaultValue={v.categoryId ?? ""} className="input"><option value="">Not set</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
      <div><label className="label" htmlFor="c-st">Status</label><select id="c-st" name="status" defaultValue={v.status ?? "ACTIVE"} className="input">{CAMPAIGN_STATUSES.map((c) => <option key={c} value={c}>{c.toLowerCase()}</option>)}</select></div>
      <div className="sm:col-span-2"><label className="label" htmlFor="c-desc">Description</label><textarea id="c-desc" name="description" rows={2} defaultValue={v.description ?? ""} className="input" /></div>
      <div className="sm:col-span-2"><label className="label" htmlFor="c-obj">Objectives</label><textarea id="c-obj" name="objectives" rows={2} defaultValue={v.objectives ?? ""} className="input" /></div>
      <div><label className="label" htmlFor="c-own">Owner</label><select id="c-own" name="ownerId" defaultValue={v.ownerId ?? ""} className="input"><option value="">Not set</option>{staff.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div>
      <div><label className="label" htmlFor="c-ch">Lead channel</label><select id="c-ch" name="channel" defaultValue={v.channel ?? "OTHER"} className="input">{CHANNELS.map((c) => <option key={c} value={c}>{c.toLowerCase().replace("_", " ")}</option>)}</select></div>
      <div><label className="label" htmlFor="c-s">Starts</label><input id="c-s" name="startDate" type="date" defaultValue={v.startDate ?? ""} className="input" /></div>
      <div><label className="label" htmlFor="c-e">Ends</label><input id="c-e" name="endDate" type="date" defaultValue={v.endDate ?? ""} className="input" /></div>
      <div><label className="label" htmlFor="c-bud">Budget</label><input id="c-bud" name="budget" inputMode="decimal" defaultValue={v.budget ?? ""} placeholder="Leave empty if none" className="input" /></div>
      <div><label className="label" htmlFor="c-cur">Currency</label><select id="c-cur" name="currency" defaultValue={v.currency ?? "USD"} className="input">{["PKR", "USD", "AED", "GBP"].map((c) => <option key={c}>{c}</option>)}</select></div>
      <div className="sm:col-span-2"><label className="label" htmlFor="c-n">Notes</label><input id="c-n" name="notes" defaultValue={v.notes ?? ""} className="input" /></div>
    </div>
  );
}
