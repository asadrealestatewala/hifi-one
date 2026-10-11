"use client";

import { useState } from "react";
import LineItems, { type TaxPreset } from "@/components/ui/LineItems";

type ClientOpt = { id: string; name: string; currency: string };

export default function InvoiceForm({ action, clients, taxPresets, closeTo, error }: { action: (f: FormData) => void | Promise<void>; clients: ClientOpt[]; taxPresets: TaxPreset[]; closeTo: string; error?: string }) {
  const [currency, setCurrency] = useState("USD");
  return (
    <form action={action} className="flex h-full flex-col">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
        {error && <p role="alert" className="rounded-lg bg-brand/10 px-3 py-2 text-sm text-brand">{error}</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="clientId">Client</label>
            <select id="clientId" name="clientId" required className="input" defaultValue="" onChange={(e) => { const c = clients.find((x) => x.id === e.target.value); if (c && ["PKR", "USD", "AED", "GBP"].includes(c.currency)) setCurrency(c.currency); }}>
              <option value="">Choose…</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.currency})</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="currency">Currency</label>
            <select id="currency" name="currency" className="input" value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {["PKR", "USD", "AED", "GBP"].map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
        </div>
        <LineItems currency={currency} taxPresets={taxPresets} />
        <div>
          <label className="label" htmlFor="notes">Notes</label>
          <textarea id="notes" name="notes" rows={2} className="input" />
        </div>
      </div>
      <footer className="flex items-center justify-between gap-3 border-t border-border bg-surface px-5 py-3">
        <p className="text-xs text-muted">Saved as a draft. Nothing is posted until you issue it.</p>
        <div className="flex gap-2"><a href={closeTo} className="btn-ghost">Cancel</a><button className="btn">Save draft</button></div>
      </footer>
    </form>
  );
}
