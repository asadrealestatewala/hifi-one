"use client";

import { useActionState } from "react";
import { inviteVendor, type VendorInviteState } from "./actions";

export default function VendorInviteForm({ vendorId, defaultEmail }: { vendorId: string; defaultEmail: string }) {
  const [state, action, pending] = useActionState<VendorInviteState, FormData>(inviteVendor, {});
  return (
    <form action={action} className="card space-y-3 max-w-xl">
      <h2 className="font-semibold">Vendor portal access</h2>
      <p className="text-sm text-muted">One-time link valid for 7 days. Email delivery is not connected yet, so copy the link and send it to the vendor yourself.</p>
      <input type="hidden" name="vendorId" value={vendorId} />
      <div className="flex gap-2">
        <input name="email" type="email" required defaultValue={defaultEmail} aria-label="Vendor contact email" className="input" />
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
