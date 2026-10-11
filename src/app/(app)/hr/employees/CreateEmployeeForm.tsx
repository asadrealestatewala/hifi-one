"use client";

import { useActionState } from "react";
import { createEmployeeAction, type CreateState } from "./actions";

export default function CreateEmployeeForm({ roles, managers }: { roles: { key: string; name: string }[]; managers: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState<CreateState, FormData>(createEmployeeAction, {});
  return (
    <form action={action} className="card grid gap-4 sm:grid-cols-2">
      <h2 className="font-semibold sm:col-span-2">Add employee</h2>
      {state.error && <p role="alert" className="sm:col-span-2 text-sm text-brand bg-brand/10 rounded-lg px-3 py-2">{state.error}</p>}
      {state.created && (
        <div className="sm:col-span-2 text-sm rounded-lg bg-green-600/10 px-3 py-2 space-y-1">
          <p><strong>{state.created.name}</strong> created as {state.created.employeeNo}. Give them this one-time starting password (shown only now); they should change it after signing in:</p>
          <input readOnly value={state.created.password} aria-label="Starting password" className="input font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
          <p className="text-xs text-muted">Sign-in email: {state.created.email}</p>
        </div>
      )}
      <div><label className="label" htmlFor="name">Full name</label><input id="name" name="name" required className="input" /></div>
      <div><label className="label" htmlFor="email">Work email</label><input id="email" name="email" type="email" required className="input" /></div>
      <div><label className="label" htmlFor="roleKey">Role</label>
        <select id="roleKey" name="roleKey" className="input">{roles.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}</select></div>
      <div><label className="label" htmlFor="designation">Designation</label><input id="designation" name="designation" className="input" /></div>
      <div><label className="label" htmlFor="employmentType">Employment type</label>
        <select id="employmentType" name="employmentType" className="input">{["FULL_TIME", "PART_TIME", "CONTRACT", "INTERN"].map((t) => <option key={t}>{t}</option>)}</select></div>
      <div><label className="label" htmlFor="workLocation">Work location</label>
        <select id="workLocation" name="workLocation" className="input">{["OFFICE", "REMOTE", "HYBRID", "FIELD"].map((t) => <option key={t}>{t}</option>)}</select></div>
      <div><label className="label" htmlFor="joinDate">Date of joining</label><input id="joinDate" name="joinDate" type="date" className="input" /></div>
      <div><label className="label" htmlFor="managerId">Reports to</label>
        <select id="managerId" name="managerId" className="input"><option value="">No manager</option>{managers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></div>
      <div className="sm:col-span-2"><button className="btn" disabled={pending}>{pending ? "Creating…" : "Create employee"}</button></div>
    </form>
  );
}
