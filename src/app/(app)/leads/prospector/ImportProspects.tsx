"use client";

import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import Icon from "@/components/shell/Icon";
import { runProspectImport, type ImportView } from "./actions";

type Option = { code?: string; id?: string; label: string };
const FIELDS: [string, string, boolean][] = [
  ["name", "Business name", true], ["phone", "Phone", false], ["email", "Email", false], ["website", "Website", false],
  ["maps", "Google Maps link", false], ["status", "Status (what happened)", false], ["notes", "Remarks / notes", false], ["city", "City or area", false],
];
const colLetter = (i: number) => { let n = i, out = ""; do { out = String.fromCharCode(65 + (n % 26)) + out; n = Math.floor(n / 26) - 1; } while (n >= 0); return out; };
const colName = (headers: string[], i: number) => (headers[i] ? headers[i] : `Column ${colLetter(i)}`);
const KIND_LABEL: Record<string, string> = { invalid: "Missing or invalid details", inFile: "Repeated in the file", prospect: "Already a prospect", lead: "Already a CRM lead", suppressed: "On the do-not-contact list" };

function ImportForm({ countries, defaultCountry, agents, onClose }: { countries: Option[]; defaultCountry: string; agents: Option[]; onClose: () => void }) {
  const [view, action, pending] = useActionState<ImportView, FormData>(runProspectImport, {});
  const formRef = useRef<HTMLFormElement>(null);
  const [fileName, setFileName] = useState("");
  const send = (intent: "inspect" | "preview" | "import") => {
    const form = formRef.current;
    if (!form) return;
    const data = new FormData(form);
    data.set("intent", intent);
    startTransition(() => action(data));
  };
  const hasSheets = Boolean(view.sheets?.length);
  const counts = view.preview?.counts ?? view.done?.counts;
  const skipped = view.preview?.skipped ?? view.done?.skipped ?? [];
  const sheetsFor = view.sheets ?? [];

  return (
    <form ref={formRef} onSubmit={(e) => { e.preventDefault(); send(view.done ? "inspect" : hasSheets ? "preview" : "inspect"); }} noValidate className="space-y-4 p-4" aria-label="Import prospects">
      <div>
        <label className="label" htmlFor="ip-file">Excel (.xlsx) or CSV file</label>
        <input id="ip-file" name="file" type="file" accept=".xlsx,.xlsm,.csv" className="input" onChange={(e) => { setFileName(e.target.files?.[0]?.name ?? ""); if (e.target.files?.length) send("inspect"); }} />
        <p className="mt-1 text-xs text-muted">One row per business. Every tab of an Excel file can be imported. Up to 1,000 rows at a time.</p>
      </div>

      {view.error && <p role="alert" className="rounded-lg bg-brand/10 px-3 py-2 text-sm text-brand">{view.error}</p>}

      {hasSheets && !view.done && (
        <>
          <fieldset className="space-y-3">
            <legend className="text-sm font-medium">Tabs and columns in {view.fileName ?? fileName}</legend>
            <p className="text-xs text-muted">We matched the columns by their names. Check each tab; change a column if it is wrong. Columns you leave as &ldquo;Not in the file&rdquo; are ignored.</p>
            {sheetsFor.map((sh) => (
              <div key={sh.index} className="rounded-xl border border-border p-3">
                <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" name="sheet" value={sh.index} defaultChecked /> {sh.name} <span className="text-xs font-normal text-muted">({sh.rows} rows)</span></label>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {FIELDS.map(([f, label, required]) => (
                    <div key={f}>
                      <label className="label" htmlFor={`ip-${sh.index}-${f}`}>{label}{required ? " *" : ""}</label>
                      <select id={`ip-${sh.index}-${f}`} name={`map:${sh.index}:${f}`} defaultValue={sh.map[f] ?? ""} className="input">
                        <option value="">Not in the file</option>
                        {sh.headers.map((_, i) => <option key={i} value={i}>{colName(sh.headers, i)}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
                {sh.sample.length > 0 && (
                  <p className="mt-3 break-words text-xs text-muted">First row: {sh.sample[0].map((c, i) => (c ? `${colName(sh.headers, i)}: ${c}` : "")).filter(Boolean).join(" · ").slice(0, 260)}</p>
                )}
              </div>
            ))}
          </fieldset>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="ip-country">Phone numbers are from</label>
              <select id="ip-country" name="country" defaultValue={defaultCountry} className="input">{countries.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}</select>
              <p className="mt-1 text-xs text-muted">Numbers without a country code (3359275375, 0335 9275375) get this one.</p>
            </div>
            <div>
              <label className="label" htmlFor="ip-label">Source label</label>
              <input id="ip-label" name="label" defaultValue="Manual scrape" maxLength={40} className="input" />
              <p className="mt-1 text-xs text-muted">Shown beside each prospect. The tab name is kept as the detail.</p>
            </div>
            <div>
              <label className="label" htmlFor="ip-assign">Assign to</label>
              <select id="ip-assign" name="assignToId" defaultValue="" className="input"><option value="">Nobody yet (assign later)</option>{agents.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</select>
            </div>
            <label className="flex items-start gap-2 self-end text-sm"><input type="checkbox" name="closeNo" value="1" defaultChecked className="mt-0.5" /> Keep rows whose status says &ldquo;Not interested&rdquo; closed, so nobody calls them again</label>
          </div>
        </>
      )}

      {counts && (
        <div className="space-y-3" role="status">
          <p className={`rounded-lg px-3 py-2 text-sm ${view.done ? "bg-success/10 text-success" : "bg-hover"}`}>
            {view.done
              ? <><strong>{view.done.imported} prospect{view.done.imported === 1 ? "" : "s"} imported</strong> as &ldquo;{view.done.label}&rdquo;{view.done.assigned ? `, ${view.done.assigned} assigned` : ", unassigned"}{view.done.closed ? `, ${view.done.closed} kept closed as not interested` : ""}. {skipped.length ? `${skipped.length} row${skipped.length === 1 ? "" : "s"} were left out (below).` : ""}</>
              : <><strong>{counts.ready} ready to import</strong>{counts.closed ? ` (${counts.closed} of them closed as not interested)` : ""}. {counts.withWebsite} have a website, {counts.withMaps} a Maps link. Left out: {counts.invalid + counts.inFile + counts.prospect + counts.lead + counts.suppressed}. Nothing has been saved yet.</>}
          </p>
          {!view.done && view.preview && view.preview.sample.length > 0 && (
            <ul className="divide-y divide-border rounded-xl border border-border text-sm">
              {view.preview.sample.map((r, i) => (
                <li key={i} className="flex flex-wrap items-baseline justify-between gap-x-3 px-3 py-2"><span className="min-w-0 break-words font-medium">{r.name}</span><span className="text-xs text-muted">{r.phone ?? "no phone"} · {r.website ? "website" : "no website"}{r.closed ? " · closed" : ""}</span></li>
              ))}
            </ul>
          )}
          {skipped.length > 0 && (
            <details className="rounded-xl border border-border" open={Boolean(view.done) && skipped.length <= 10}>
              <summary className="cursor-pointer px-3 py-2 text-sm font-medium">Left out ({[counts.invalid, counts.inFile, counts.prospect, counts.lead, counts.suppressed].reduce((a, b) => a + b, 0)}){view.preview?.ignored ? `, plus ${view.preview.ignored} heading or blank lines ignored` : ""}</summary>
              <ul className="max-h-64 divide-y divide-border overflow-y-auto text-sm">
                {skipped.map((k, i) => (
                  <li key={i} className="px-3 py-2"><p className="break-words"><span className="font-medium">{k.name}</span> <span className="text-xs text-muted">{k.sheet}, row {k.row}</span></p><p className="text-xs text-muted">{KIND_LABEL[k.kind]}: {k.reason}</p></li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
        <button type="button" className="btn-ghost" onClick={onClose}>{view.done ? "Close" : "Cancel"}</button>
        {hasSheets && !view.done && <button type="button" className="btn-ghost" disabled={pending} onClick={() => send("preview")}>{pending ? "Checking…" : "Check the file"}</button>}
        {hasSheets && !view.done && view.preview && view.preview.counts.ready > 0 && <button type="button" className="btn" disabled={pending} onClick={() => send("import")}>{pending ? "Importing…" : `Import ${view.preview.counts.ready} prospect${view.preview.counts.ready === 1 ? "" : "s"}`}</button>}
        {!hasSheets && <button type="submit" className="btn" disabled={pending || !fileName}>{pending ? "Reading…" : "Read file"}</button>}
      </div>
    </form>
  );
}

// "Import prospects" for sales managers: a file of businesses someone collected by hand. Opens as a sheet from the bottom on a phone.
export default function ImportProspects({ countries, defaultCountry, agents }: { countries: Option[]; defaultCountry: string; agents: Option[] }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", k);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", k); document.body.style.overflow = ""; };
  }, [open]);
  return (
    <div>
      <button type="button" className="btn-ghost inline-flex items-center gap-1.5" onClick={() => setOpen(true)}><Icon name="upload" /> Import prospects</button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label="Import prospects">
          <button type="button" aria-label="Close" onClick={() => setOpen(false)} className="absolute inset-0 bg-black/40" />
          <div className="relative max-h-[92dvh] w-full max-w-2xl overflow-y-auto rounded-t-2xl bg-background shadow-2xl sm:rounded-2xl">
            <header className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-surface px-4 py-3">
              <h2 className="text-lg font-semibold tracking-tight">Import prospects</h2>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="rounded-lg p-1.5 text-muted hover:bg-hover hover:text-foreground"><Icon name="close" /></button>
            </header>
            <ImportForm countries={countries} defaultCountry={defaultCountry} agents={agents} onClose={() => setOpen(false)} />
          </div>
        </div>
      )}
    </div>
  );
}
