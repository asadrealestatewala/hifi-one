"use client";

import { useActionState } from "react";
import { createStaffUser, type LinkState } from "./actions";

export default function CreateUserForm({ roles }: { roles: { key: string; name: string }[] }) {
  const [state, action, pending] = useActionState<LinkState, FormData>(createStaffUser, {});
  return (
    <form action={action} className="card space-y-3">
      <h2 className="font-semibold">Add a staff user</h2>
      <p className="text-xs text-muted">They get a one-time link (valid 24 hours) to set their own password. Email is not connected yet, so copy the link and send it yourself. Clients and vendors are invited from their own pages.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div><label className="label" htmlFor="name">Full name</label><input id="name" name="name" required className="input" /></div>
        <div><label className="label" htmlFor="email">Work email</label><input id="email" name="email" type="email" required className="input" /></div>
      </div>
      <fieldset>
        <legend className="label">Roles</legend>
        <div className="grid gap-1 sm:grid-cols-3 text-sm">{roles.map((r) => <label key={r.key} className="flex items-center gap-2"><input type="checkbox" name="roleKeys" value={r.key} /> {r.name}</label>)}</div>
      </fieldset>
      <button className="btn" disabled={pending}>{pending ? "Creating…" : "Create user"}</button>
      {state.error && <p role="alert" className="text-sm text-brand">{state.error}</p>}
      {state.link && (
        <div className="text-sm space-y-1">
          <p className="font-semibold">{state.done} Send them this link (shown only once):</p>
          <input readOnly value={state.link} aria-label="Set-password link" className="input font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
        </div>
      )}
    </form>
  );
}
