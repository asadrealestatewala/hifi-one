"use client";

import { useActionState, useState } from "react";
import { Notice, SubmitButton } from "@/components/ui";
import { sendAgreementAction, type SendState } from "./actions";

export default function SendForm({ id, defaultName, defaultEmail, resend }: { id: string; defaultName: string; defaultEmail: string; resend: boolean }) {
  const [state, action] = useActionState<SendState, FormData>(sendAgreementAction, {});
  const [copied, setCopied] = useState(false);
  const link = state.token && typeof window !== "undefined" ? `${window.location.origin}/sign/${state.token}` : "";
  return (
    <section className="card space-y-3">
      <h2 className="font-semibold">{resend ? "Issue a new signing link" : "Send for signature"}</h2>
      <p className="text-xs text-muted">{resend ? "A new link replaces the old one, which stops working. " : ""}The text is frozen when you send it. The signer needs no account; the link works once and expires after 14 days. Hifi One does not send email for you yet, so copy the link and send it yourself.</p>
      <form action={action} className="grid gap-2 sm:grid-cols-2">
        <input type="hidden" name="id" value={id} />
        <div><label className="label" htmlFor="sg-name">Signer&apos;s full name</label><input id="sg-name" name="signerName" required minLength={3} maxLength={120} defaultValue={defaultName} className="input" /></div>
        <div><label className="label" htmlFor="sg-email">Signer&apos;s email (optional)</label><input id="sg-email" name="signerEmail" type="email" defaultValue={defaultEmail} className="input" /></div>
        <div className="sm:col-span-2"><SubmitButton className="btn">{resend ? "Issue new link" : "Freeze and create link"}</SubmitButton></div>
      </form>
      {state.error && <Notice kind="error">{state.error}</Notice>}
      {link && (
        <div className="space-y-2 rounded-xl border border-success/40 bg-success/5 p-3 text-sm" role="status">
          <p className="font-medium">Signing link. Copy it now: it is not shown again.</p>
          <input readOnly value={link} aria-label="Signing link" className="input font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
          <button type="button" className="btn-ghost !py-1 text-xs" onClick={() => { void navigator.clipboard?.writeText(link); setCopied(true); }}>{copied ? "Copied" : "Copy link"}</button>
        </div>
      )}
    </section>
  );
}
