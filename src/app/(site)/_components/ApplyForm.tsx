"use client";

import { useState } from "react";
import { Icon } from "./Icon";

type Status = { kind: "idle" } | { kind: "sending" } | { kind: "sent" } | { kind: "error"; message: string; field?: string };
const MAX_CV = 5 * 1024 * 1024;

// The job application form. Sends to /api/site/apply, which saves the application and CV for HR in the ERP.
export function ApplyForm({ jobId, jobTitle }: { jobId: number; jobTitle: string }) {
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [cvName, setCvName] = useState("");

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const cv = data.get("cv");
    if (cv instanceof File && cv.size > MAX_CV) {
      setStatus({ kind: "error", message: "Your CV is larger than 5 MB. Please upload a smaller PDF or Word file.", field: "cv" });
      return;
    }
    if (cv instanceof File && cv.size === 0) data.delete("cv");
    setStatus({ kind: "sending" });
    try {
      const res = await fetch("/api/site/apply", { method: "POST", body: data });
      const out = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; field?: string };
      if (res.ok && out.ok) {
        setStatus({ kind: "sent" });
        return;
      }
      setStatus({ kind: "error", message: out.error ?? "Your application could not be sent. Please try again.", field: out.field });
      if (out.field) form.querySelector<HTMLElement>(`[name="${out.field}"]`)?.focus();
    } catch {
      setStatus({ kind: "error", message: "We could not reach the server. Check your connection and try again." });
    }
  }

  if (status.kind === "sent") {
    return (
      <div className="hs-success" role="status">
        <div className="hs-ok"><Icon name="check" size={30} /></div>
        <h3>Application received</h3>
        <p>Thank you for applying for {jobTitle}. Our HR team reviews every application and will contact you if you are shortlisted.</p>
      </div>
    );
  }

  const err = status.kind === "error" ? status : null;
  const invalid = (f: string) => (err?.field === f ? true : undefined);

  return (
    <form className="hs-form" onSubmit={submit} encType="multipart/form-data" aria-describedby={err ? "apply-error" : undefined}>
      <input type="hidden" name="jobId" value={jobId} />
      <div className="hs-field">
        <label htmlFor="a-name">Full name</label>
        <input id="a-name" name="name" className="hs-input" required minLength={2} maxLength={120} autoComplete="name" aria-invalid={invalid("name")} />
      </div>
      <div className="hs-field">
        <label htmlFor="a-email">Email</label>
        <input id="a-email" name="email" type="email" className="hs-input" required maxLength={200} autoComplete="email" aria-invalid={invalid("email")} />
      </div>
      <div className="hs-field">
        <label htmlFor="a-phone">Phone or WhatsApp</label>
        <input id="a-phone" name="phone" type="tel" className="hs-input" required maxLength={40} autoComplete="tel" aria-invalid={invalid("phone")} />
      </div>
      <div className="hs-field">
        <label htmlFor="a-cv">CV <span className="opt">(PDF or Word, up to 5 MB)</span></label>
        <input id="a-cv" name="cv" type="file" className="hs-input" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" aria-invalid={invalid("cv")} aria-describedby="a-cv-hint" onChange={(e) => setCvName(e.target.files?.[0]?.name ?? "")} />
        <p id="a-cv-hint" className="hs-hint">{cvName ? `Selected: ${cvName}` : "Upload a CV, or add a LinkedIn or portfolio link below."}</p>
      </div>
      <div className="hs-field">
        <label htmlFor="a-link">LinkedIn or portfolio link <span className="opt">(optional)</span></label>
        <input id="a-link" name="profileUrl" type="url" className="hs-input" maxLength={300} placeholder="https://" aria-invalid={invalid("profileUrl")} />
      </div>
      <div className="hs-field">
        <label htmlFor="a-note">Anything you would like us to know? <span className="opt">(optional)</span></label>
        <textarea id="a-note" name="coverNote" className="hs-input" maxLength={3000} style={{ minHeight: 110 }} />
      </div>
      <div className="hs-trap" aria-hidden="true">
        <label htmlFor="a-website">Leave this empty</label>
        <input id="a-website" name="website_url" tabIndex={-1} autoComplete="off" />
      </div>
      {err && <p id="apply-error" className="hs-alert hs-alert-error" role="alert">{err.message}</p>}
      <button type="submit" className="hs-btn" disabled={status.kind === "sending"}>
        {status.kind === "sending" ? "Sending…" : <>Send application <Icon name="arrow" size={16} /></>}
      </button>
      <p className="hs-hint">Your details are used only for recruitment at HIFI Marketing &amp; Technologies.</p>
    </form>
  );
}
