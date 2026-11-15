"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import LineItems, { type LineValue } from "@/components/ui/LineItems";
import SubmitButton from "@/components/ui/SubmitButton";
import { Notice } from "@/components/ui";
import InvoicePreview from "./InvoicePreview";
import type { EditorData } from "./editor-data";

const CURRENCIES = ["PKR", "USD", "AED", "GBP"];
export type EditorInitial = { id: string; number: string | null; clientId: string; currency: string; taxRate: string; notes: string; templateKey: string | null; lines: LineValue[] };

// Form on the left, the invoice as the client will see it on the right; both follow every keystroke.
export default function InvoiceEditor({ data, action, initial, error, defaultClientId, cancelHref }: {
  data: EditorData; action: (f: FormData) => void | Promise<void>; initial?: EditorInitial; error?: string; defaultClientId?: string; cancelHref: string;
}) {
  const startClient = data.clients.find((c) => c.id === (initial?.clientId ?? defaultClientId));
  const [clientId, setClientId] = useState(startClient?.id ?? "");
  const [currency, setCurrency] = useState(initial?.currency ?? (startClient && CURRENCIES.includes(startClient.currency) ? startClient.currency : "USD"));
  const [template, setTemplate] = useState(initial?.templateKey && data.templates.some((t) => t.key === initial.templateKey) ? initial.templateKey : data.defaultTemplate);
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [lines, setLines] = useState<LineValue[]>(initial?.lines ?? []);
  const [tax, setTax] = useState(initial?.taxRate ?? "0");
  const onLines = useCallback((l: LineValue[], t: string) => { setLines(l); setTax(t); }, []);
  const client = data.clients.find((c) => c.id === clientId) ?? null;
  const terms = client?.paymentTermsDays ?? null;
  const due = terms === null ? "-" : terms === 0 ? "On receipt" : `${terms} days after issue`;
  return (
    <form action={action} className="grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      {initial && <input type="hidden" name="id" value={initial.id} />}
      <input type="hidden" name="templateKey" value={template} />
      <section className="card space-y-4">
        {error && <Notice kind="error">{error}</Notice>}
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="clientId">Client</label>
            <select id="clientId" name="clientId" required className="input" value={clientId} onChange={(e) => { setClientId(e.target.value); const c = data.clients.find((x) => x.id === e.target.value); if (c && CURRENCIES.includes(c.currency)) setCurrency(c.currency); }}>
              <option value="">Choose…</option>
              {data.clients.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.currency})</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="currency">Currency</label>
            <select id="currency" name="currency" className="input" value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
        </div>
        <LineItems currency={currency} taxPresets={data.taxPresets} initial={initial?.lines} initialTax={initial?.taxRate} onChange={onLines} />
        <div>
          <label className="label" htmlFor="notes">Notes (printed on the invoice)</label>
          <textarea id="notes" name="notes" rows={2} className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          <p className="text-xs text-muted">Saved as a draft. Nothing is posted until you issue it, and drafts can be edited until then.</p>
          <div className="flex gap-2">
            <Link href={cancelHref} className="btn-ghost">Cancel</Link>
            <SubmitButton>{initial ? "Save changes" : "Save draft"}</SubmitButton>
          </div>
        </footer>
      </section>
      <section className="space-y-3 xl:sticky xl:top-4 xl:self-start" aria-label="Preview">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div role="radiogroup" aria-label="Invoice template" className="inline-flex rounded-lg border border-border bg-surface p-0.5">
            {data.templates.map((t) => (
              <button key={t.key} type="button" role="radio" aria-checked={template === t.key} onClick={() => setTemplate(t.key)}
                className={`rounded-md px-3 py-1.5 text-sm transition ${template === t.key ? "bg-primary text-white" : "text-muted hover:bg-hover"}`}>{t.label}</button>
            ))}
          </div>
          {initial && <a className="btn-ghost text-sm" href={`/finance/invoices/${initial.id}/pdf`} target="_blank" rel="noopener">Saved PDF</a>}
        </div>
        <InvoicePreview template={template} currency={currency} number={initial?.number ? `No. ${initial.number}` : "Number on issue"} issued="On issue" due={due}
          company={data.company} client={client} lines={lines} taxRate={tax} notes={notes}
          bank={data.banks[currency] ?? []} bankInstructions={data.bankInstructions[currency]} footer={data.footer} stamp={data.stamp} />
        <p className="text-xs text-muted">Live preview. The PDF is the official copy and uses the same layout; dates and the invoice number are set when you issue it.</p>
      </section>
    </form>
  );
}
