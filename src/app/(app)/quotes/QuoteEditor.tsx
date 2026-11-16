"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import LineItems, { type LineValue, type PlanOpt } from "@/components/ui/LineItems";
import SubmitButton from "@/components/ui/SubmitButton";
import { Notice } from "@/components/ui";
import DocPreview, { type PreviewLine } from "@/components/DocPreview";
import type { EditorData } from "@/lib/doc-editor-data";

const CURRENCIES = ["PKR", "USD", "AED", "GBP"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const longDate = (d: string) => { const x = new Date(`${d}T00:00:00Z`); return Number.isNaN(x.getTime()) ? "-" : `${x.getUTCDate()} ${MONTHS[x.getUTCMonth()]} ${x.getUTCFullYear()}`; };

export type QuoteInitial = {
  id: string; number: string; clientId: string; currency: string; taxRate: string; validUntil: string; notes: string; terms: string; templateKey: string | null;
  title: string; introduction: string; scope: string; timeline: string; lines: LineValue[];
};

// Proposal sections are optional: with none filled in, the document is a plain quotation.
const SECTIONS = [
  { key: "introduction", label: "Introduction", hint: "Who you are and what the client is trying to achieve.", rows: 4 },
  { key: "scope", label: "Scope of work", hint: "What is included, deliverable by deliverable. One per line reads well.", rows: 5 },
  { key: "timeline", label: "Timeline", hint: "Milestones and when they happen, e.g. Week 1: kickoff.", rows: 3 },
] as const;
type SectionKey = (typeof SECTIONS)[number]["key"];

// Form on the left, the proposal as the client will see it on the right; both follow every keystroke.
export default function QuoteEditor({ data, plans, action, initial, error, defaultClientId, cancelHref }: {
  data: EditorData; plans: PlanOpt[]; action: (f: FormData) => void | Promise<void>; initial?: QuoteInitial; error?: string; defaultClientId?: string; cancelHref: string;
}) {
  const startClient = data.clients.find((c) => c.id === (initial?.clientId ?? defaultClientId));
  const [clientId, setClientId] = useState(startClient?.id ?? "");
  const [currency, setCurrency] = useState(initial?.currency ?? (startClient && CURRENCIES.includes(startClient.currency) ? startClient.currency : "USD"));
  const [template, setTemplate] = useState(initial?.templateKey && data.templates.some((t) => t.key === initial.templateKey) ? initial.templateKey : data.defaultTemplate);
  const [title, setTitle] = useState(initial?.title ?? "");
  const [sec, setSec] = useState<Record<SectionKey, string>>({ introduction: initial?.introduction ?? "", scope: initial?.scope ?? "", timeline: initial?.timeline ?? "" });
  const [validUntil, setValidUntil] = useState(initial?.validUntil ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [terms, setTerms] = useState(initial?.terms ?? "");
  const [lines, setLines] = useState<LineValue[]>(initial?.lines ?? []);
  const [tax, setTax] = useState(initial?.taxRate ?? "0");
  const onLines = useCallback((l: LineValue[], t: string) => { setLines(l); setTax(t); }, []);
  const client = data.clients.find((c) => c.id === clientId) ?? null;
  const proposal = Object.values(sec).some((v) => v.trim());
  // A plan line shows its setup fee as its own line, as it will be saved
  const previewLines: PreviewLine[] = lines.flatMap((l) => {
    const plan = l.plan ? plans.find((p) => p.id === l.plan) : undefined;
    const fee = plan?.prices?.[currency]?.setupFee;
    return fee && Number(fee) > 0 ? [l, { desc: `Setup fee: ${plan?.name ?? ""}`, qty: "1", price: fee }] : [l];
  });
  const valid = validUntil ? longDate(validUntil) : "-";
  const number = initial ? `No. ${initial.number} (draft)` : "Number on save";
  return (
    <form action={action} className="grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      {initial && <input type="hidden" name="id" value={initial.id} />}
      <input type="hidden" name="templateKey" value={template} />
      <section className="card space-y-4">
        {error && <Notice kind="error">{error}</Notice>}
        <div className="grid gap-3 sm:grid-cols-3">
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
          <div>
            <label className="label" htmlFor="validUntil">Valid until</label>
            <input id="validUntil" name="validUntil" type="date" className="input" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
          </div>
        </div>
        <div>
          <label className="label" htmlFor="title">Title (optional)</label>
          <input id="title" name="title" maxLength={200} className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Social media management for Biztrack UK" />
        </div>
        <fieldset className="space-y-3 rounded-xl border border-border p-3">
          <legend className="px-1 text-sm font-medium">Proposal sections (optional)</legend>
          <p className="text-xs text-muted">Fill any of these and the document prints as a proposal. Leave them all empty for a plain quotation.</p>
          {SECTIONS.map((x) => (
            <div key={x.key}>
              <label className="label" htmlFor={x.key}>{x.label}</label>
              <textarea id={x.key} name={x.key} rows={x.rows} maxLength={x.key === "timeline" ? 3000 : 5000} className="input" value={sec[x.key]} onChange={(e) => setSec((s) => ({ ...s, [x.key]: e.target.value }))} placeholder={x.hint} />
            </div>
          ))}
        </fieldset>
        <div>
          <p className="label">Pricing</p>
          <p className="mb-2 text-xs text-muted">Pick a catalog plan to fill its name and price in the chosen currency (any setup fee becomes its own line), or type a custom line.</p>
          <LineItems currency={currency} taxPresets={data.taxPresets} plans={plans} initial={initial?.lines} initialTax={initial?.taxRate} onChange={onLines} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="notes">Notes</label>
            <textarea id="notes" name="notes" rows={2} maxLength={2000} className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="terms">Terms</label>
            <textarea id="terms" name="terms" rows={2} maxLength={3000} className="input" value={terms} onChange={(e) => setTerms(e.target.value)} placeholder="e.g. 50% upfront, balance on delivery" />
          </div>
        </div>
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          <p className="text-xs text-muted">Saved as a draft. You can edit it until you send it to the client.</p>
          <div className="flex gap-2">
            <Link href={cancelHref} className="btn-ghost">Cancel</Link>
            <SubmitButton>{initial ? "Save changes" : "Save draft"}</SubmitButton>
          </div>
        </footer>
      </section>
      <section className="space-y-3 xl:sticky xl:top-4 xl:self-start" aria-label="Preview">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div role="radiogroup" aria-label="Layout" className="inline-flex rounded-lg border border-border bg-surface p-0.5">
            {data.templates.map((t) => (
              <button key={t.key} type="button" role="radio" aria-checked={template === t.key} onClick={() => setTemplate(t.key)}
                className={`rounded-md px-3 py-1.5 text-sm transition ${template === t.key ? "bg-primary text-white" : "text-muted hover:bg-hover"}`}>{t.label}</button>
            ))}
          </div>
          {initial && <a className="btn-ghost text-sm" href={`/quotes/${initial.id}/pdf`} target="_blank" rel="noopener">Saved PDF</a>}
        </div>
        <DocPreview template={template} currency={currency} number={number} issued="" due=""
          word={proposal ? "PROPOSAL" : "QUOTATION"} partyLabel="PREPARED FOR" payableLabel="Total" showTotalRow={false}
          meta={[["DATE", "On sending"], ["VALID UNTIL", valid], ["CURRENCY", currency]]}
          minimalMeta={{ label: "Date / valid until", value: `On sending / ${valid}`, small: `Currency ${currency}` }}
          title={title.trim() || undefined}
          before={SECTIONS.map((x) => ({ heading: x.label, body: sec[x.key] }))}
          after={[{ heading: "Terms", body: terms }]}
          company={data.company} client={client} lines={previewLines} taxRate={tax} notes={notes}
          bank={[]} stamp={data.stamp}
          footer={[data.footer, `This ${proposal ? "proposal" : "quotation"} is not an invoice. Prices are valid until the date shown. Accept it in the client portal or reply to us in writing.`].filter(Boolean).join("\n")} />
        <p className="text-xs text-muted">Live preview. The PDF is the official copy and uses the same layout; the date is set when you send it.</p>
      </section>
    </form>
  );
}
