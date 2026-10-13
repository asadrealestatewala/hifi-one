"use client";

import { useId, useRef, useState } from "react";
import { useFormStatus } from "react-dom";

// A button for destructive or financial actions (cancel, void, write off, delete, revoke). Place it inside the
// <form> that performs the action. The first click opens a confirmation dialog; only "Confirm" submits the form.
// With `reason`, the dialog asks why and sends it as the form field `reason` (required, at least 5 characters).
export default function ConfirmButton({ children, title, message, confirmLabel, reason = false, className = "btn-ghost" }: {
  children: React.ReactNode; title: string; message: React.ReactNode; confirmLabel?: string; reason?: boolean; className?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const uid = useId();
  const [text, setText] = useState("");
  const { pending } = useFormStatus();
  const ok = !reason || text.trim().length >= 5;
  return (
    <>
      <button type="button" className={className} disabled={pending} onClick={() => dialog.current?.showModal()}>{pending ? "Working…" : children}</button>
      <dialog ref={dialog} aria-labelledby={`${uid}-t`} className="m-auto w-[min(26rem,calc(100vw-2rem))] rounded-2xl border border-border bg-surface p-0 text-foreground shadow-2xl backdrop:bg-black/40"
        onClose={() => setText("")}>
        <div className="space-y-3 p-5">
          <h2 id={`${uid}-t`} className="text-base font-semibold">{title}</h2>
          <div className="text-sm text-muted">{message}</div>
          {reason && (
            <div>
              <label className="label" htmlFor={`${uid}-r`}>Reason (recorded in the audit log)</label>
              <textarea id={`${uid}-r`} name="reason" rows={2} required minLength={5} value={text} onChange={(e) => setText(e.target.value)} className="input" autoFocus />
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <button type="button" className="btn-ghost" onClick={() => dialog.current?.close()}>Keep it</button>
          <button type="submit" className="btn !bg-brand hover:!bg-brand-dark" disabled={!ok} onClick={() => { if (ok) setTimeout(() => dialog.current?.close(), 0); }}>{confirmLabel ?? "Confirm"}</button>
        </div>
      </dialog>
    </>
  );
}
