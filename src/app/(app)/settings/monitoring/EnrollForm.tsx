"use client";

import { useActionState } from "react";
import { enrollCodeAction, type CodeState } from "./actions";
import { Notice } from "@/components/ui";

// Shows the one-time code on screen only (never in the address bar or the history).
export default function EnrollForm({ people }: { people: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState<CodeState, FormData>(enrollCodeAction, {});
  return (
    <div className="space-y-3">
      <form action={action} className="flex flex-wrap items-end gap-3">
        <div><label className="label" htmlFor="enrol-user">Staff member</label><select id="enrol-user" name="userId" required className="input !w-64"><option value="">Choose…</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
        <button className="btn-ghost" disabled={pending}>Create enrolment code</button>
      </form>
      {state.error && <Notice kind="error">{state.error}</Notice>}
      {state.code && (
        <div className="rounded-xl border border-border bg-hover p-4">
          <p className="text-xs text-muted">One-time code for {state.person}. It works once and expires in an hour. Give it to them in person or by a private message.</p>
          <p className="mt-1 font-mono text-2xl font-semibold tracking-widest">{state.code}</p>
        </div>
      )}
    </div>
  );
}
