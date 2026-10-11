"use client";

import { useActionState } from "react";
import { changeRoles, makeResetLink, resetMfa, toggleActive, type LinkState } from "../actions";

const Note = ({ s }: { s: LinkState }) => (
  <>
    {s.error && <p role="alert" className="text-sm text-brand">{s.error}</p>}
    {s.done && <p className="text-sm text-green-700">{s.done}</p>}
  </>
);

export default function UserActions({
  userId, active, isStaff, mfaOn, roles, held,
}: { userId: string; active: boolean; isStaff: boolean; mfaOn: boolean; roles: { key: string; name: string }[]; held: string[] }) {
  const [rolesState, rolesAction, rolesPending] = useActionState<LinkState, FormData>(changeRoles, {});
  const [linkState, linkAction, linkPending] = useActionState<LinkState, FormData>(makeResetLink, {});
  const [activeState, activeAction, activePending] = useActionState<LinkState, FormData>(toggleActive, {});
  const [mfaState, mfaAction, mfaPending] = useActionState<LinkState, FormData>(resetMfa, {});
  return (
    <div className="space-y-4">
      {isStaff && (
        <form action={rolesAction} className="card space-y-3">
          <input type="hidden" name="userId" value={userId} />
          <h2 className="font-semibold">Roles</h2>
          <div className="grid gap-1 sm:grid-cols-3 text-sm">{roles.map((r) => <label key={r.key} className="flex items-center gap-2"><input type="checkbox" name="roleKeys" value={r.key} defaultChecked={held.includes(r.key)} /> {r.name}</label>)}</div>
          <button className="btn" disabled={rolesPending}>Save roles</button>
          <Note s={rolesState} />
        </form>
      )}
      <form action={linkAction} className="card space-y-2">
        <input type="hidden" name="userId" value={userId} />
        <h2 className="font-semibold">Password</h2>
        <p className="text-xs text-muted">Creates a one-hour link for the person to choose a new password. It signs them out everywhere when used. Copy and send it yourself.</p>
        <button className="btn-ghost" disabled={linkPending}>Create reset link</button>
        <Note s={linkState} />
        {linkState.link && <input readOnly value={linkState.link} aria-label="Reset link" className="input font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />}
      </form>
      {mfaOn && (
        <form action={mfaAction} className="card space-y-2">
          <input type="hidden" name="userId" value={userId} />
          <h2 className="font-semibold">Two-step verification</h2>
          <p className="text-xs text-muted">Use only after confirming the person&apos;s identity. They are signed out and can set it up again.</p>
          <button className="btn-ghost" disabled={mfaPending}>Reset two-step verification</button>
          <Note s={mfaState} />
        </form>
      )}
      <form action={activeAction} className="card space-y-2">
        <input type="hidden" name="userId" value={userId} />
        <input type="hidden" name="active" value={active ? "0" : "1"} />
        <h2 className="font-semibold">Account status</h2>
        <button className="btn-ghost" disabled={activePending}>{active ? "Deactivate account" : "Reactivate account"}</button>
        <Note s={activeState} />
      </form>
    </div>
  );
}
