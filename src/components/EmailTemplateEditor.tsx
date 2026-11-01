"use client";

import { useActionState, useMemo, useRef, useState } from "react";
import { Notice, SubmitButton } from "@/components/ui";
import { TEMPLATE_LIMITS, renderEmail, type Blocks, type Brand, type TemplateContent } from "@/lib/email-templates";

export type EditorState = { ok?: string; error?: string; n?: number };

type Props = {
  action: (prev: EditorState, f: FormData) => Promise<EditorState>;
  hidden: Record<string, string>;
  initial: TemplateContent & { name?: string };
  variables: Record<string, string>;
  brand: Brand;
  blocks?: Blocks;
  sampleButtonUrl?: string | null; // built-in emails: where the system links (the editor shows the label only)
  withName?: boolean;
  withButtonUrl?: boolean;
  unsubscribe?: boolean;
};

type Field = "subject" | "preheader" | "heading" | "body" | "buttonLabel" | "buttonUrl" | "highlights";

// Template editor: the fields on the left, the email exactly as it will be sent on the right (rendered by the same code
// that sends it, with sample values). Clicking a variable inserts it where the cursor was.
export default function EmailTemplateEditor(p: Props) {
  const [state, action] = useActionState<EditorState, FormData>(p.action, {});
  const [v, setV] = useState<Record<Field | "name", string>>({
    name: p.initial.name ?? "", subject: p.initial.subject, preheader: p.initial.preheader ?? "", heading: p.initial.heading, body: p.initial.body,
    buttonLabel: p.initial.buttonLabel ?? "", buttonUrl: p.initial.buttonUrl ?? "", highlights: p.initial.highlights ?? "",
  });
  const [width, setWidth] = useState<"desktop" | "phone">("desktop");
  const last = useRef<{ field: Field; el: HTMLInputElement | HTMLTextAreaElement } | null>(null);

  const preview = useMemo(() => renderEmail({
    content: { subject: v.subject, preheader: v.preheader, heading: v.heading, body: v.body, buttonLabel: v.buttonLabel, buttonUrl: v.buttonUrl, highlights: v.highlights },
    vars: { company_name: p.brand.company, ...p.variables }, brand: p.brand, blocks: p.blocks, buttonUrl: p.sampleButtonUrl ?? null,
    unsubscribeUrl: p.unsubscribe ? `${p.brand.appUrl}/unsubscribe/preview` : null,
    footerNote: p.unsubscribe ? `You are receiving this because you contacted ${p.brand.company}.` : null,
  }), [v, p.brand, p.variables, p.blocks, p.sampleButtonUrl, p.unsubscribe]);

  const set = (k: Field | "name") => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setV((o) => ({ ...o, [k]: e.target.value }));
    if (k !== "name") last.current = { field: k, el: e.target };
  };
  const remember = (k: Field) => (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => { last.current = { field: k, el: e.target }; };
  const insert = (name: string) => {
    const tag = `{{${name}}}`;
    const t = last.current ?? null;
    const field: Field = t?.field ?? "body";
    const el = t?.el;
    const at = el?.selectionStart ?? v[field].length;
    const end = el?.selectionEnd ?? at;
    setV((o) => ({ ...o, [field]: o[field].slice(0, at) + tag + o[field].slice(end) }));
    requestAnimationFrame(() => { if (el) { el.focus(); el.setSelectionRange(at + tag.length, at + tag.length); } });
  };

  const input = (k: Field, label: string, hint?: string, max?: number) => (
    <div>
      <label className="label" htmlFor={`tpl-${k}`}>{label}</label>
      <input id={`tpl-${k}`} name={k} className="input" value={v[k]} onChange={set(k)} onFocus={remember(k)} maxLength={max} />
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
      <form action={action} className="card space-y-4">
        {Object.entries(p.hidden).map(([k, val]) => <input key={k} type="hidden" name={k} value={val} />)}
        {state.error && <Notice kind="error">{state.error}</Notice>}
        {state.ok && <Notice kind="ok">{state.ok}</Notice>}
        {p.withName && (
          <div><label className="label" htmlFor="tpl-name">Template name (only staff see this)</label><input id="tpl-name" name="name" className="input" required value={v.name} onChange={set("name")} maxLength={TEMPLATE_LIMITS.name} /></div>
        )}
        {input("subject", "Subject line", undefined, TEMPLATE_LIMITS.subject)}
        {input("preheader", "Preview text", "The grey line inboxes show after the subject, and the line under the heading.", TEMPLATE_LIMITS.preheader)}
        {input("heading", "Heading", undefined, TEMPLATE_LIMITS.heading)}
        <div>
          <label className="label" htmlFor="tpl-body">Message</label>
          <textarea id="tpl-body" name="body" className="input font-[inherit]" rows={9} value={v.body} onChange={set("body")} onFocus={remember("body")} maxLength={TEMPLATE_LIMITS.body} />
          <p className="mt-1 text-xs text-muted">Leave a blank line between paragraphs. Start a line with &quot;- &quot; for a bullet, wrap words in **double stars** for bold. Web addresses become links.</p>
        </div>
        <div className={p.withButtonUrl ? "grid gap-3 sm:grid-cols-2" : ""}>
          {input("buttonLabel", "Button text", p.withButtonUrl ? undefined : "Leave empty for no button. The button opens the right page automatically.", TEMPLATE_LIMITS.buttonLabel)}
          {p.withButtonUrl && input("buttonUrl", "Button link", "https://…, or mailto:{{owner_email}}", TEMPLATE_LIMITS.buttonUrl)}
        </div>
        <div>
          <label className="label" htmlFor="tpl-highlights">Highlight cards (optional)</label>
          <textarea id="tpl-highlights" name="highlights" className="input font-[inherit]" rows={3} value={v.highlights} onChange={set("highlights")} onFocus={remember("highlights")} maxLength={TEMPLATE_LIMITS.highlights} placeholder={"Strategy first | A plan built around your goals"} />
          <p className="mt-1 text-xs text-muted">Up to three lines, each &quot;Title | short text&quot;. Shown as cards side by side (stacked on phones).</p>
        </div>
        <div>
          <p className="label">Variables (click to insert where the cursor is)</p>
          <div className="flex flex-wrap gap-1.5">
            {Object.keys({ company_name: "", ...p.variables }).map((k) => (
              <button key={k} type="button" onClick={() => insert(k)} title={`Preview value: ${k === "company_name" ? p.brand.company : p.variables[k]}`} className="rounded-full border border-border bg-hover/60 px-2.5 py-1 font-mono text-xs hover:border-primary hover:text-primary">{`{{${k}}}`}</button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-2 border-t border-border pt-4">
          <SubmitButton pendingText="Saving…">Save template</SubmitButton>
          <button type="submit" name="intent" value="test" className="btn-ghost">Save and email me a test</button>
        </div>
      </form>

      <section className="card !p-0 overflow-hidden" aria-label="Preview">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div className="min-w-0 text-sm">
            <p className="truncate"><span className="text-muted">Subject:</span> <strong>{preview.subject}</strong></p>
            <p className="truncate text-xs text-muted">Shown with sample values. Real emails use each person&apos;s own details.</p>
          </div>
          <div className="flex rounded-full border border-border p-0.5 text-xs" role="group" aria-label="Preview width">
            {(["desktop", "phone"] as const).map((w) => (
              <button key={w} type="button" aria-pressed={width === w} onClick={() => setWidth(w)} className={`rounded-full px-3 py-1 ${width === w ? "bg-primary text-white" : "text-muted hover:text-foreground"}`}>{w === "desktop" ? "Desktop" : "Phone"}</button>
            ))}
          </div>
        </div>
        <div className="bg-[#f3f4f8] p-3 sm:p-5">
          <iframe title="Email preview" sandbox="" srcDoc={preview.html} className="mx-auto block h-[46rem] rounded-lg border-0 bg-white transition-[width] duration-200" style={{ width: width === "desktop" ? "100%" : 380, maxWidth: "100%" }} />
        </div>
      </section>
    </div>
  );
}
