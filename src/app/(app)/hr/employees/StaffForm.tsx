"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Notice, SubmitButton } from "@/components/ui";
import { createStaffAction, updateStaffAction, type StaffFormState } from "./actions";

type Opt = { id: string; name: string };
export type StaffValues = {
  id?: string; name: string; email: string; phone: string; alternatePhone: string; designation: string; departmentId: string;
  employmentType: string; joinDate: string; managerId: string; notes: string; identityNumber: string;
};

// One form for adding and editing a staff member. Only the name is required; everything else can be completed later.
export default function StaffForm({ mode, values, roles, departments, managers, canSensitive, closeTo }: {
  mode: "create" | "edit"; values?: StaffValues; roles?: { key: string; name: string }[]; departments: Opt[]; managers: Opt[]; canSensitive: boolean; closeTo: string;
}) {
  const [state, action] = useActionState<StaffFormState, FormData>(mode === "create" ? createStaffAction : updateStaffAction, {});
  // After a refused save, show what was typed rather than the original values
  const v: Partial<StaffValues> | undefined = state.values ? { ...values, ...state.values } : values;
  if (state.created) {
    return (
      <div className="space-y-3 p-5">
        <Notice kind="ok"><strong>{state.created.name}</strong> was added as {state.created.employeeNo}.</Notice>
        {state.created.onboarding && <p className="text-sm">{state.created.onboarding} <Link className="underline" href="/hr/onboarding">Onboarding approvals</Link></p>}
        {state.created.link ? (
          <div className="space-y-1">
            <p className="text-sm">Only if the email does not arrive: send this one-time setup link to the person yourself (valid 72 hours). They choose their own password; nobody else ever sees it.</p>
            <input readOnly value={state.created.link} aria-label="Setup link" className="input font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
          </div>
        ) : <p className="text-sm text-muted">Someone who manages user access can create a sign-in setup link from the staff record.</p>}
        <div className="flex gap-2"><Link className="btn" href={`/hr/employees/${state.created.id}`}>Open the record</Link><Link className="btn-ghost" href={closeTo}>Close</Link></div>
      </div>
    );
  }
  const f = (name: keyof StaffValues, label: string, opts: { type?: string; required?: boolean; hint?: string; placeholder?: string } = {}) => (
    <div>
      <label className="label" htmlFor={`s-${name}`}>{label}{opts.required && <span className="text-brand"> *</span>}</label>
      <input id={`s-${name}`} name={name} type={opts.type ?? "text"} required={opts.required} defaultValue={v?.[name] ?? ""} placeholder={opts.placeholder} className="input" aria-describedby={opts.hint ? `s-${name}-h` : undefined} />
      {opts.hint && <p id={`s-${name}-h`} className="mt-1 text-xs text-muted">{opts.hint}</p>}
    </div>
  );
  return (
    <form key={state.n ?? 0} action={action} className={mode === "create" ? "flex h-full flex-col" : "card"}>
      <div className={mode === "create" ? "min-h-0 flex-1 space-y-4 overflow-y-auto p-5" : "space-y-4"}>
        {state.error && <Notice kind="error">{state.error}</Notice>}
        {state.saved && <Notice kind="ok">Changes saved.</Notice>}
        {v?.id && <input type="hidden" name="id" value={v.id} />}
        <div className="grid gap-4 sm:grid-cols-2">
          {f("name", "Full name", { required: true })}
          {f("designation", "Designation")}
          {f("email", "Official email", { type: "email", hint: "Optional. Used to sign in." })}
          {f("phone", "Contact number", { type: "tel", placeholder: "+923001234567", hint: "Optional. With country code; can also be used to sign in." })}
          {f("alternatePhone", "Alternate contact", { type: "tel" })}
          <div><label className="label" htmlFor="s-dep">Department</label><select id="s-dep" name="departmentId" defaultValue={v?.departmentId ?? ""} className="input"><option value="">Not set</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></div>
          <div><label className="label" htmlFor="s-type">Employment type</label><select id="s-type" name="employmentType" defaultValue={v?.employmentType ?? "FULL_TIME"} className="input">{["FULL_TIME", "PART_TIME", "CONTRACT", "INTERN"].map((t) => <option key={t} value={t}>{t.replace("_", " ").toLowerCase()}</option>)}</select></div>
          {f("joinDate", "Joining date", { type: "date" })}
          <div><label className="label" htmlFor="s-mgr">Reporting manager</label><select id="s-mgr" name="managerId" defaultValue={v?.managerId ?? ""} className="input"><option value="">None</option>{managers.filter((m) => m.id !== v?.id).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></div>
          {canSensitive ? f("identityNumber", "CNIC (restricted)", { hint: state.error && mode === "create" ? "Enter it again: it is not sent back after an error." : "13 digits. Only HR and administrators can see it." }) : <p className="self-end text-xs text-muted">CNIC is restricted to authorized HR users.</p>}
        </div>
        {roles && (
          <fieldset>
            <legend className="label">Roles (what they can access)</legend>
            <div className="grid gap-1 text-sm sm:grid-cols-2">{roles.map((r) => <label key={r.key} className="flex items-center gap-2"><input type="checkbox" name="roleKeys" value={r.key} defaultChecked={state.roleKeys?.includes(r.key)} />{r.name}</label>)}</div>
          </fieldset>
        )}
        <div><label className="label" htmlFor="s-notes">Notes</label><textarea id="s-notes" name="notes" rows={2} defaultValue={v?.notes ?? ""} className="input" /></div>
        {state.sameName && <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="allowSameName" /> This is a different person with the same name</label>}
      </div>
      <div className={mode === "create" ? "flex items-center justify-end gap-2 border-t border-border bg-surface px-5 py-3" : "mt-4 flex gap-2"}>
        {mode === "create" && <Link href={closeTo} className="btn-ghost">Cancel</Link>}
        <SubmitButton>{mode === "create" ? "Add staff member" : "Save changes"}</SubmitButton>
      </div>
    </form>
  );
}
