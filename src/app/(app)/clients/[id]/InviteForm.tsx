"use client";

import { useActionState } from "react";
import { inviteToPortal, type InviteState } from "./actions";

export default function InviteForm({ clientId }: { clientId: string }) {
  const [state, action, pending] = useActionState<InviteState, FormData>(inviteToPortal, {});
  return (
    <form action={action} className="card space-y-3 max-w-xl">
      <h2 className="font-semibold">Client portal access</h2>
      <p className="text-sm text-muted">
        Creates a one-time link valid for 7 days. Email delivery is not connected yet, so copy the link and send it to the client yourself.
      </p>
      <input type="hidden" name="clientId" value={clientId} />
      <div className="flex gap-2">
        <input name="email" type="email" required placeholder="Client contact email" aria-label="Client contact email" className="input" />
        <button className="btn" disabled={pending}>{pending ? "Creating…" : "Create link"}</button>
      </div>
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
