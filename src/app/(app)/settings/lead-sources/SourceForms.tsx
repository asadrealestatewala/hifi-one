"use client";

import { useActionState, useState } from "react";
import { Notice, SubmitButton } from "@/components/ui";
import { createSourceAction, rotateKeyAction, type SourceState } from "./actions";

const snippet = (key: string, origin: string) => `<form id="hifi-lead">
  <input name="name" placeholder="Your name" required>
  <input name="email" type="email" placeholder="Email">
  <input name="phone" placeholder="Phone">
  <textarea name="message" placeholder="How can we help?"></textarea>
  <!-- hidden trap for bots; leave empty -->
  <input name="website_url" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px">
  <button>Send</button>
</form>
<script>
document.getElementById("hifi-lead").addEventListener("submit", async (e) => {
  e.preventDefault();
  const body = Object.fromEntries(new FormData(e.target));
  const q = new URLSearchParams(location.search);
  Object.assign(body, { utm_source: q.get("utm_source"), utm_medium: q.get("utm_medium"), utm_campaign: q.get("utm_campaign"), landing_url: location.href });
  const r = await fetch("${origin}/api/leads/capture", { method: "POST", headers: { "content-type": "application/json", "x-lead-key": "${key}" }, body: JSON.stringify(body) });
  const j = await r.json();
  alert(j.ok ? "Thank you, we will be in touch." : j.error);
});
</script>`;

function KeyBox({ state }: { state: SourceState }) {
  const [copied, setCopied] = useState(false);
  if (!state.key) return null;
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return (
    <div className="space-y-2 rounded-xl border border-success/40 bg-success/5 p-3 text-sm" role="status">
      <p className="font-medium">Key for {state.name}. Copy it now: it is not shown again.</p>
      <input readOnly value={state.key} aria-label="Form key" className="input font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
      <details><summary className="cursor-pointer text-primary">Website code to paste</summary>
        <textarea readOnly value={snippet(state.key, origin)} rows={12} aria-label="Website code" className="input mt-2 font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
        <button type="button" className="btn-ghost mt-1 !py-1 text-xs" onClick={() => { void navigator.clipboard?.writeText(snippet(state.key!, origin)); setCopied(true); }}>{copied ? "Copied" : "Copy code"}</button>
      </details>
      <p className="text-xs text-muted">The key is public in the page it is pasted into. That is fine: it only lets visitors send leads to this form, and you can list the websites allowed to use it or replace the key at any time.</p>
    </div>
  );
}

export function NewSourceForm({ campaigns, staff }: { campaigns: { id: string; name: string }[]; staff: { id: string; name: string }[] }) {
  const [state, action] = useActionState<SourceState, FormData>(createSourceAction, {});
  return (
    <form action={action} className="card space-y-3">
      <h2 className="font-semibold">New website form</h2>
      {state.error && <Notice kind="error">{state.error}</Notice>}
      <KeyBox state={state} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div><label className="label" htmlFor="ls-name">Name</label><input id="ls-name" name="name" required maxLength={80} placeholder="Classwell website" className="input" /></div>
        <div><label className="label" htmlFor="ls-camp">Campaign</label><select id="ls-camp" name="campaignId" className="input"><option value="">No campaign</option>{campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <div><label className="label" htmlFor="ls-mode">Who gets the leads</label><select id="ls-mode" name="assignMode" defaultValue="ROUND_ROBIN" className="input"><option value="ROUND_ROBIN">Take turns (round robin)</option><option value="FIXED">Always the first person chosen</option><option value="NONE">Nobody; managers are told</option></select></div>
        <div><label className="label" htmlFor="ls-orig">Allowed websites (optional)</label><input id="ls-orig" name="allowedOrigins" placeholder="https://classwell.com, https://www.classwell.com" className="input" /></div>
      </div>
      <fieldset><legend className="label">People who receive these leads</legend><div className="grid max-h-40 gap-1 overflow-y-auto text-sm sm:grid-cols-3">{staff.map((p) => <label key={p.id} className="flex items-center gap-2"><input type="checkbox" name="assigneeIds" value={p.id} />{p.name}</label>)}</div></fieldset>
      <SubmitButton pendingText="Creating…">Create form</SubmitButton>
    </form>
  );
}

export function RotateKey({ id, name }: { id: string; name: string }) {
  const [state, action] = useActionState<SourceState, FormData>(rotateKeyAction, {});
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="id" value={id} /><input type="hidden" name="name" value={name} />
      <SubmitButton className="btn-ghost !py-1 text-xs" pendingText="Replacing…">Replace key</SubmitButton>
      {state.error && <Notice kind="error">{state.error}</Notice>}
      <KeyBox state={state} />
    </form>
  );
}
