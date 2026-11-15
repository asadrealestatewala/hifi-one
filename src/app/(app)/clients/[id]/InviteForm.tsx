"use client";

import { useActionState } from "react";
import { inviteToPortal, type InviteState } from "./actions";

export default function InviteForm({ clientId, defaultEmail = "", defaultPhone = "" }: { clientId: string; defaultEmail?: string; defaultPhone?: string }) {
  const [state, action, pending] = useActionState<InviteState, FormData>(inviteToPortal, {});
  return (
    <form action={action} className="card space-y-3 max-w-xl">
      <h2 className="font-semibold">Client portal access</h2>
      <p className="text-sm text-muted">
        Creates a one-time link valid for 7 days. Copy it and send it to the client yourself (for example on WhatsApp). The client signs in with the email or the contact number below, whichever you fill in; an email can be added later.
      </p>
      <input type="hidden" name="clientId" value={clientId} />
      <div className="grid gap-2 sm:grid-cols-2">
        <div><label className="label" htmlFor="inv-email">Email (optional)</label><input id="inv-email" name="email" type="email" defaultValue={defaultEmail} placeholder="name@company.com" className="input" /></div>
        <div><label className="label" htmlFor="inv-phone">Contact number (optional)</label><input id="inv-phone" name="phone" type="tel" defaultValue={defaultPhone} placeholder="+923001234567" className="input" /></div>
      </div>
      <button className="btn" disabled={pending}>{pending ? "Creating…" : "Create link"}</button>
      {state.error && <p role="alert" className="text-sm text-brand">{state.error}</p>}
      {state.link && (
        <div className="text-sm space-y-1">
          <p className="font-semibold">Invitation link (shown only once):</p>
          <input readOnly value={state.link} aria-label="Invitation link" className="input font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
        </div>
      )}
    </form>
  );
}
