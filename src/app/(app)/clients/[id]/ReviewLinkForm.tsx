"use client";

import { useActionState } from "react";
import { makeReviewLink, type ReviewLinkState } from "./delivery-actions";

// Staff make last week's review form link by hand, for a client with no email on file. The link is shown once.
export default function ReviewLinkForm({ clientId, weeks }: { clientId: string; weeks: { value: string; label: string }[] }) {
  const [state, action, pending] = useActionState<ReviewLinkState, FormData>(makeReviewLink, {});
  return (
    <form action={action} className="space-y-2 border-t border-border pt-3">
      <input type="hidden" name="clientId" value={clientId} />
      <div className="flex flex-wrap items-end gap-2">
        <div><label className="label" htmlFor="rl-week">Review form link for the week of</label>
          <select id="rl-week" name="weekStart" className="input">{weeks.map((w) => <option key={w.value} value={w.value}>{w.label}</option>)}</select></div>
        <button className="btn-ghost" disabled={pending}>{pending ? "Creating…" : "Create link"}</button>
      </div>
      {state.error && <p role="alert" className="text-sm text-brand">{state.error}</p>}
      {state.link && (
        <div className="space-y-1 text-sm">
          <p className="font-semibold">Send this link to the client (shown only once, works for 14 days, no password needed):</p>
          <input readOnly value={state.link} aria-label="Review form link" className="input font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
        </div>
      )}
    </form>
  );
}
