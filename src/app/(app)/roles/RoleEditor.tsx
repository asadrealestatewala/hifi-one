"use client";

import { useActionState } from "react";
import { addRole, removeRole, saveRole, type RoleState } from "./actions";
import { ConfirmButton } from "@/components/ui";

type Perm = { key: string; description: string };
export type Group = { name: string; perms: Perm[] };

function Checks({ groups, held, grantable, locked }: { groups: Group[]; held: string[]; grantable: string[]; locked: boolean }) {
  return (
    <div className="space-y-3">
      {groups.map((g) => (
        <fieldset key={g.name}>
          <legend className="text-xs font-semibold uppercase tracking-wide text-muted mb-1">{g.name}</legend>
          <div className="grid gap-1 sm:grid-cols-2 text-sm">
            {g.perms.map((p) => {
              const on = held.includes(p.key);
              // A limited administrator can neither add nor remove a permission they do not hold themselves
              const disabled = locked || !grantable.includes(p.key);
              return (
                <label key={p.key} className={`flex items-start gap-2 ${disabled ? "opacity-60" : ""}`}>
                  <input type="checkbox" name="permissionKeys" value={p.key} defaultChecked={on} disabled={disabled && !on} className="mt-1" />
                  {disabled && on && <input type="hidden" name="permissionKeys" value={p.key} />}
                  <span><span className="font-mono text-xs">{p.key}</span><br /><span className="text-xs text-muted">{p.description}</span></span>
                </label>
              );
            })}
          </div>
        </fieldset>
      ))}
    </div>
  );
}

export function RoleCard({ id, name, isSystem, users, held, groups, grantable, locked, lockedReason }: {
  id: string; name: string; isSystem: boolean; users: number; held: string[]; groups: Group[]; grantable: string[]; locked: boolean; lockedReason?: string;
}) {
  const [state, save, saving] = useActionState<RoleState, FormData>(saveRole, {});
  const [delState, del] = useActionState<RoleState, FormData>(removeRole, {});
  return (
    <details className="card">
      <summary className="cursor-pointer font-semibold">{name} <span className="text-xs font-normal text-muted">{isSystem ? "built-in" : "custom"} · {users} user(s) · {held.length} permission(s)</span></summary>
      <div className="mt-3 space-y-3">
        {lockedReason && <p className="text-sm text-muted">{lockedReason}</p>}
        <form action={save} className="space-y-3">
          <input type="hidden" name="roleId" value={id} />
          <Checks groups={groups} held={held} grantable={grantable} locked={locked} />
          {!locked && <button className="btn" disabled={saving}>Save permissions</button>}
          {state.error && <p role="alert" className="text-sm text-brand">{state.error}</p>}
          {state.done && <p className="text-sm text-green-700">{state.done}</p>}
        </form>
        {!isSystem && (
          <form action={del} className="border-t border-border pt-3">
            <input type="hidden" name="roleId" value={id} />
            <ConfirmButton title="Delete this role?" message="People who hold only this role lose its permissions. This cannot be undone." confirmLabel="Delete role">Delete this role</ConfirmButton>
            {delState.error && <p role="alert" className="text-sm text-brand mt-1">{delState.error}</p>}
            {delState.done && <p className="text-sm text-green-700 mt-1">{delState.done}</p>}
          </form>
        )}
      </div>
    </details>
  );
}

export function NewRole({ groups, grantable }: { groups: Group[]; grantable: string[] }) {
  const [state, action, pending] = useActionState<RoleState, FormData>(addRole, {});
  return (
    <form action={action} className="card space-y-3">
      <h2 className="font-semibold">Create a custom role</h2>
      <div><label className="label" htmlFor="rname">Role name</label><input id="rname" name="name" required className="input max-w-sm" /></div>
      <Checks groups={groups} held={[]} grantable={grantable} locked={false} />
      <button className="btn" disabled={pending}>Create role</button>
      {state.error && <p role="alert" className="text-sm text-brand">{state.error}</p>}
      {state.done && <p className="text-sm text-green-700">{state.done}</p>}
    </form>
  );
}
