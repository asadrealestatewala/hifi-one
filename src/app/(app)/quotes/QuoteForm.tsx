"use client";

import { useState } from "react";
import LineItems, { type PlanOpt, type TaxPreset } from "@/components/ui/LineItems";
import { Notice } from "@/components/ui";

type ClientOpt = { id: string; name: string; currency: string };
const CURRENCIES = ["PKR", "USD", "AED", "GBP"];

export default function QuoteForm({ action, clients, plans, taxPresets, closeTo, error }: { action: (f: FormData) => void | Promise<void>; clients: ClientOpt[]; plans: PlanOpt[]; taxPresets: TaxPreset[]; closeTo: string; error?: string }) {
  const [currency, setCurrency] = useState("USD");
  return (
    <form action={action} className="flex h-full flex-col">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
        {error && <Notice kind="error">{error}</Notice>}
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className="label" htmlFor="clientId">Client</label>
            <select id="clientId" name="clientId" required className="input" defaultValue="" onChange={(e) => { const c = clients.find((x) => x.id === e.target.value); if (c && CURRENCIES.includes(c.currency)) setCurrency(c.currency); }}>
              <option value="">Choose…</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.currency})</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="currency">Currency</label>
            <select id="currency" name="currency" className="input" value={currency} onChange={(e) => setCurrency(e.target.value)}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select>
          </div>
          <div><label className="label" htmlFor="validUntil">Valid until</label><input id="validUntil" name="validUntil" type="date" className="input" /></div>
        </div>
        <p className="text-xs text-muted">Pick a catalog plan to fill its name and its price in the chosen currency (any setup fee becomes its own line), or type a custom line. A plan with no price in that currency is refused.</p>
        <LineItems currency={currency} taxPresets={taxPresets} plans={plans} />
        <div className="grid gap-3 sm:grid-cols-2">
          <div><label className="label" htmlFor="notes">Notes</label><textarea id="notes" name="notes" rows={2} className="input" /></div>
          <div><label className="label" htmlFor="terms">Terms</label><textarea id="terms" name="terms" rows={2} className="input" placeholder="e.g. 50% upfront, balance on delivery" /></div>
        </div>
      </div>
      <footer className="flex items-center justify-between gap-3 border-t border-border bg-surface px-5 py-3">
        <p className="text-xs text-muted">Saved as a draft. Plan lines are priced when you save.</p>
        <div className="flex gap-2"><a href={closeTo} className="btn-ghost">Cancel</a><button className="btn">Save draft</button></div>
      </footer>
    </form>
  );
}
