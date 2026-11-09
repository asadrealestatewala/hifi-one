"use client";

import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import Icon from "@/components/shell/Icon";
import { addOwnProspect, type AddState } from "./actions";

type Country = { code: string; label: string };
type CampaignOption = { id: string; name: string };
const SOURCES = [["REFERRAL", "Referral"], ["OWN_CONTACT", "Own contact"], ["OTHER", "Other"]] as const;

function Field({ id, label, error, hint, children }: { id: string; label: string; error?: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="label" htmlFor={id}>{label}</label>
      {children}
      {error ? <p id={`${id}-err`} role="alert" className="mt-1 text-xs text-brand">{error}</p> : hint ? <p id={`${id}-hint`} className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

// The quick form. It lives in its own component so each time the sheet opens it starts empty. It is sent from onSubmit, not as a form action,
// because a form action clears every field when it finishes, and a failed save must keep what was typed.
function QuickForm({ countries, campaigns, defaultCountry, onDone, onClose }: { countries: Country[]; campaigns: CampaignOption[]; defaultCountry: string; onDone: (message: string) => void; onClose: () => void }) {
  const [state, action, pending] = useActionState<AddState, FormData>(addOwnProspect, {});
  const nameRef = useRef<HTMLInputElement>(null);
  const err = (f: string) => (state.error && state.field === f ? state.error : undefined);
  const general = state.error && !["name", "phone", "email", "source", "campaignId", "website", "mapsUrl"].includes(state.field ?? "") ? state.error : undefined;
  useEffect(() => { nameRef.current?.focus(); }, []);
  useEffect(() => { if (state.ok && state.message) onDone(state.message); }, [state, onDone]);
  const warn = Boolean(state.error?.includes("Add anyway"));
  return (
    <form onSubmit={(e) => { e.preventDefault(); const data = new FormData(e.currentTarget); startTransition(() => action(data)); }} noValidate className="space-y-3 p-4" aria-label="Add a prospect">
      <Field id="ap-name" label="Business or person's name" error={err("name")}>
        <input ref={nameRef} id="ap-name" name="name" required maxLength={160} autoComplete="off" className="input" aria-invalid={Boolean(err("name"))} aria-describedby={err("name") ? "ap-name-err" : undefined} />
      </Field>
      <Field id="ap-phone" label="Phone" error={err("phone")} hint="Type it the way you would dial it. The country code is added for you.">
        <div className="flex gap-2">
          <select name="country" defaultValue={defaultCountry} aria-label="Country code" className="input !w-[9.5rem] shrink-0">
            {countries.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
          </select>
          <input id="ap-phone" name="phone" type="tel" inputMode="tel" autoComplete="off" maxLength={40} placeholder="0300 1234567" className="input min-w-0 flex-1" aria-invalid={Boolean(err("phone"))} aria-describedby={err("phone") ? "ap-phone-err" : "ap-phone-hint"} />
        </div>
      </Field>
      <Field id="ap-email" label="Email (optional)" error={err("email")}>
        <input id="ap-email" name="email" type="email" inputMode="email" autoComplete="off" maxLength={200} className="input" aria-invalid={Boolean(err("email"))} aria-describedby={err("email") ? "ap-email-err" : undefined} />
      </Field>
      <Field id="ap-source" label="Where did you find them?" error={err("source")}>
        <select id="ap-source" name="source" defaultValue="" className="input" aria-invalid={Boolean(err("source"))} aria-describedby={err("source") ? "ap-source-err" : undefined}>
          <option value="" disabled>Choose a source</option>
          {SOURCES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </Field>
      <Field id="ap-campaign" label="Campaign (optional)" error={err("campaignId")} hint="The prospect keeps this campaign when it becomes a lead.">
        <select id="ap-campaign" name="campaignId" defaultValue="" className="input" aria-invalid={Boolean(err("campaignId"))} aria-describedby={err("campaignId") ? "ap-campaign-err" : "ap-campaign-hint"}>
          <option value="">No campaign</option>
          {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </Field>
      <Field id="ap-website" label="Website (optional)" error={err("website")}>
        <input id="ap-website" name="website" type="url" inputMode="url" autoComplete="off" maxLength={300} placeholder="www.company.com" className="input" aria-invalid={Boolean(err("website"))} aria-describedby={err("website") ? "ap-website-err" : undefined} />
      </Field>
      <Field id="ap-maps" label="Google Maps link (optional)" error={err("mapsUrl")} hint="In Google Maps press Share, then Copy link.">
        <input id="ap-maps" name="mapsUrl" type="url" inputMode="url" autoComplete="off" maxLength={500} placeholder="https://maps.app.goo.gl/…" className="input" aria-invalid={Boolean(err("mapsUrl"))} aria-describedby={err("mapsUrl") ? "ap-maps-err" : "ap-maps-hint"} />
      </Field>
      <Field id="ap-note" label="Quick note (optional)" hint="Shows as Remarks on the lead when this prospect is converted.">
        <textarea id="ap-note" name="note" rows={3} maxLength={1000} placeholder="Who referred them, what they need, when to call" className="input" />
      </Field>
      {warn && <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="confirm" value="1" className="mt-0.5" /> Add anyway, this is a different person</label>}
      {general && <p role="alert" className="rounded-lg bg-brand/10 px-3 py-2 text-sm text-brand">{general}</p>}
      <div className="flex items-center justify-end gap-2 pt-1">
        <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
        <button type="submit" className="btn" disabled={pending} aria-disabled={pending}>{pending ? "Checking and saving…" : "Add prospect"}</button>
      </div>
    </form>
  );
}

// "Add prospect" button for a salesperson who found someone themselves. Opens a short form as a sheet from the bottom on a phone.
export default function AddProspect({ countries, campaigns, defaultCountry }: { countries: Country[]; campaigns: CampaignOption[]; defaultCountry: string }) {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", k);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", k); document.body.style.overflow = ""; };
  }, [open]);
  return (
    <div className="space-y-2">
      <button type="button" className="btn inline-flex items-center gap-1.5" onClick={() => { setDone(null); setOpen(true); }}><Icon name="plus" /> Add prospect</button>
      {done && <p role="status" className="rounded-lg bg-success/10 px-3 py-2 text-sm text-success">{done}</p>}
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label="Add prospect">
          <button type="button" aria-label="Close" onClick={() => setOpen(false)} className="absolute inset-0 bg-black/40" />
          <div className="relative max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-background shadow-2xl sm:rounded-2xl">
            <header className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-surface px-4 py-3">
              <h2 className="text-lg font-semibold tracking-tight">Add prospect</h2>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="rounded-lg p-1.5 text-muted hover:bg-hover hover:text-foreground"><Icon name="close" /></button>
            </header>
            <QuickForm countries={countries} campaigns={campaigns} defaultCountry={defaultCountry} onClose={() => setOpen(false)} onDone={(m) => { setDone(m); setOpen(false); }} />
          </div>
        </div>
      )}
    </div>
  );
}
