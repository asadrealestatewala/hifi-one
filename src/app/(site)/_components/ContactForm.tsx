"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { SERVICES } from "../_content/site";
import { Icon } from "./Icon";

type Status = { kind: "idle" } | { kind: "sending" } | { kind: "sent" } | { kind: "error"; message: string; field?: string };

const TOPICS = [...SERVICES.map((s) => s.title), "Pricing plan", "Careers", "Something else"];

// The contact form. Sends to /api/site/contact, which creates (or updates) a lead in the ERP's CRM.
export function ContactForm() {
  const params = useSearchParams();
  const plan = params.get("plan")?.slice(0, 80) ?? "";
  const service = params.get("service")?.slice(0, 80) ?? "";
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = Object.fromEntries(new FormData(form)) as Record<string, string>;
    const url = new URL(window.location.href);
    const body = { ...data, page_url: url.toString(), utm_source: url.searchParams.get("utm_source") ?? "", utm_medium: url.searchParams.get("utm_medium") ?? "", utm_campaign: url.searchParams.get("utm_campaign") ?? "" };
    setStatus({ kind: "sending" });
    try {
      const res = await fetch("/api/site/contact", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const out = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; field?: string };
      if (res.ok && out.ok) {
        setStatus({ kind: "sent" });
        form.reset();
        return;
      }
      setStatus({ kind: "error", message: out.error ?? "Your message could not be sent. Please try again, or email us.", field: out.field });
      if (out.field) form.querySelector<HTMLElement>(`[name="${out.field}"]`)?.focus();
    } catch {
      setStatus({ kind: "error", message: "We could not reach the server. Check your connection and try again, or email us." });
    }
  }

  if (status.kind === "sent") {
    return (
      <div className="hs-success" role="status">
        <div className="hs-ok"><Icon name="check" size={30} /></div>
        <h3>Thanks, your message is with our team</h3>
        <p>We usually reply within one working day. For anything urgent, call or WhatsApp us on +92 316 8080801.</p>
        <button type="button" className="hs-btn hs-btn-ghost" style={{ marginTop: 16 }} onClick={() => setStatus({ kind: "idle" })}>Send another message</button>
      </div>
    );
  }

  const err = status.kind === "error" ? status : null;
  const invalid = (f: string) => (err?.field === f ? true : undefined);
  const defaultTopic = plan ? "Pricing plan" : TOPICS.includes(service) ? service : "";
  const defaultMessage = plan ? `I'm interested in the ${plan} plan.` : "";

  return (
    <form className="hs-form" onSubmit={submit} noValidate={false} aria-describedby={err ? "contact-error" : undefined}>
      <div className="hs-form-row">
        <div className="hs-field">
          <label htmlFor="c-name">Your name</label>
          <input id="c-name" name="name" className="hs-input" required minLength={2} maxLength={120} autoComplete="name" aria-invalid={invalid("name")} />
        </div>
        <div className="hs-field">
          <label htmlFor="c-company">Company <span className="opt">(optional)</span></label>
          <input id="c-company" name="company" className="hs-input" maxLength={160} autoComplete="organization" />
        </div>
      </div>
      <div className="hs-form-row">
        <div className="hs-field">
          <label htmlFor="c-email">Email</label>
          <input id="c-email" name="email" type="email" className="hs-input" required maxLength={200} autoComplete="email" aria-invalid={invalid("email")} />
        </div>
        <div className="hs-field">
          <label htmlFor="c-phone">Phone or WhatsApp <span className="opt">(optional)</span></label>
          <input id="c-phone" name="phone" type="tel" className="hs-input" maxLength={40} autoComplete="tel" aria-invalid={invalid("phone")} />
        </div>
      </div>
      <div className="hs-field">
        <label htmlFor="c-topic">What can we help with?</label>
        <select id="c-topic" name="topic" className="hs-input" defaultValue={defaultTopic}>
          <option value="">Choose a topic</option>
          {TOPICS.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
      <div className="hs-field">
        <label htmlFor="c-message">Message</label>
        <textarea id="c-message" name="message" className="hs-input" required minLength={5} maxLength={2000} defaultValue={defaultMessage} aria-invalid={invalid("message")} />
      </div>
      {plan && <input type="hidden" name="plan" value={plan} />}
      <div className="hs-trap" aria-hidden="true">
        <label htmlFor="c-website">Leave this empty</label>
        <input id="c-website" name="website_url" tabIndex={-1} autoComplete="off" />
      </div>
      {err && <p id="contact-error" className="hs-alert hs-alert-error" role="alert">{err.message}</p>}
      <button type="submit" className="hs-btn" disabled={status.kind === "sending"}>
        {status.kind === "sending" ? "Sending…" : <>Send message <Icon name="arrow" size={16} /></>}
      </button>
      <p className="hs-hint">We use your details only to reply to this message.</p>
    </form>
  );
}
