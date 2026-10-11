"use client";

import { useState } from "react";
import Icon from "@/components/shell/Icon";

type Line = { id: number; plan: string; desc: string; qty: string; price: string };
export type PlanOpt = { id: string; label: string };
export type TaxPreset = { name: string; rate: string };

const toNum = (s: string) => { const n = Number(s); return Number.isFinite(n) && n >= 0 ? n : 0; };

// Invoice and quote lines with a running subtotal, tax and total. Fields are named desc{i}/qty{i}/price{i} so the
// existing server actions read them unchanged. The server still does the real arithmetic; this is only a preview.
export default function LineItems({ currency, taxPresets, plans, max = 20 }: { currency: string; taxPresets: TaxPreset[]; plans?: PlanOpt[]; max?: number }) {
  const [lines, setLines] = useState<Line[]>([{ id: 0, plan: "", desc: "", qty: "1", price: "" }]);
  const [next, setNext] = useState(1);
  const [tax, setTax] = useState("0");
  const sub = lines.reduce((s, l) => s + toNum(l.qty) * toNum(l.price), 0);
  const taxAmt = sub * Math.min(toNum(tax), 100) / 100;
  const fmt = (n: number) => new Intl.NumberFormat("en", { style: "currency", currency, maximumFractionDigits: 2 }).format(n);
  const set = (id: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => l.id === id ? { ...l, ...patch } : l));
  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <div className={`hidden gap-2 px-1 text-xs text-muted sm:grid ${plans ? "grid-cols-[11rem_1fr_5rem_8rem_6.5rem_2rem]" : "grid-cols-[1fr_5rem_8rem_6.5rem_2rem]"}`}>{plans && <span>Plan</span>}<span>Description</span><span>Qty</span><span>Unit price</span><span className="text-right">Amount</span><span /></div>
        {lines.map((l, i) => (
          <div key={l.id} className={`grid ${plans ? "sm:grid-cols-[11rem_1fr_5rem_8rem_6.5rem_2rem]" : "sm:grid-cols-[1fr_5rem_8rem_6.5rem_2rem]"} grid-cols-[1fr_4.5rem_6.5rem_2rem] items-center gap-2`}>
            {plans && <select name={`plan${i}`} value={l.plan} onChange={(e) => set(l.id, { plan: e.target.value })} aria-label={`Line ${i + 1} catalog plan`} className="input col-span-full sm:col-span-1 sm:order-first"><option value="">Custom line</option>{plans.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select>}
            <input name={`desc${i}`} value={l.desc} onChange={(e) => set(l.id, { desc: e.target.value })} placeholder={l.plan ? "Description (from plan)" : "Description"} aria-label={`Line ${i + 1} description`} className="input" />
            <input name={`qty${i}`} value={l.qty} onChange={(e) => set(l.id, { qty: e.target.value })} inputMode="decimal" aria-label={`Line ${i + 1} quantity`} className="input" />
            <input name={`price${i}`} value={l.price} onChange={(e) => set(l.id, { price: e.target.value })} inputMode="decimal" placeholder="0.00" aria-label={`Line ${i + 1} unit price`} className="input" />
            <span className="hidden text-right text-sm tabular-nums sm:block">{l.plan && !l.price ? "per plan" : fmt(toNum(l.qty) * toNum(l.price))}</span>
            <button type="button" aria-label={`Remove line ${i + 1}`} disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((x) => x.id !== l.id))} className="rounded-lg p-1.5 text-muted hover:bg-hover hover:text-brand disabled:opacity-30"><Icon name="close" className="h-4 w-4" /></button>
          </div>
        ))}
        {lines.length < max && <button type="button" onClick={() => { setLines((ls) => [...ls, { id: next, plan: "", desc: "", qty: "1", price: "" }]); setNext(next + 1); }} className="btn-ghost !py-1 text-sm"><Icon name="plus" className="h-4 w-4" />Add line</button>}
      </div>
      <div className="flex flex-wrap items-end justify-between gap-4 rounded-xl bg-hover p-3">
        <div>
          <label className="label" htmlFor="taxRate">Tax rate (%)</label>
          <input id="taxRate" name="taxRate" value={tax} onChange={(e) => setTax(e.target.value)} inputMode="decimal" className="input !w-28" />
          {taxPresets.length > 0 && <div className="mt-1.5 flex flex-wrap gap-1">{taxPresets.map((p) => <button key={p.name} type="button" onClick={() => setTax(p.rate)} className="rounded-full border border-border bg-surface px-2 py-0.5 text-xs hover:border-primary/50">{p.name} {p.rate}%</button>)}</div>}
        </div>
        <dl className="min-w-44 space-y-1 text-sm tabular-nums">
          <div className="flex justify-between gap-6"><dt className="text-muted">Subtotal</dt><dd>{fmt(sub)}</dd></div>
          <div className="flex justify-between gap-6"><dt className="text-muted">Tax</dt><dd>{fmt(taxAmt)}</dd></div>
          <div className="flex justify-between gap-6 border-t border-border pt-1 text-base font-semibold"><dt>Total</dt><dd>{fmt(sub + taxAmt)}</dd></div>
        </dl>
      </div>
    </div>
  );
}
