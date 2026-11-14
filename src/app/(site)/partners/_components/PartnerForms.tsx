"use client";

import { useRef, useState } from "react";
import { Icon } from "../../_components/Icon";

type Status = { kind: "idle" } | { kind: "sending" } | { kind: "sent"; duplicate?: boolean } | { kind: "error"; message: string; field?: string };
export type SolutionOption = { code: string; name: string };
export type TypeOption = { key: string; name: string };

const PROFESSIONS = [
  ["STUDENT", "University student"], ["EMPLOYED", "Employed"], ["BUSINESS_OWNER", "Business owner"],
  ["FREELANCER", "Freelancer"], ["INDUSTRY_PROFESSIONAL", "Industry professional"], ["OTHER", "Other"],
];

async function post(url: string, body: Record<string, unknown>): Promise<Status> {
  try {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const out = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; field?: string };
    if (res.ok && out.ok) return { kind: "sent" };
    return { kind: "error", message: out.error ?? "Your form could not be sent. Please try again, or email us.", field: out.field };
  } catch {
    return { kind: "error", message: "We could not reach the server. Check your connection and try again, or email us." };
  }
}

function Trap({ id }: { id: string }) {
  return (
    <div className="hs-trap" aria-hidden="true">
      <label htmlFor={id}>Leave this empty</label>
      <input id={id} name="website_url" tabIndex={-1} autoComplete="off" />
    </div>
  );
}

function Done({ title, text, again }: { title: string; text: string; again: () => void }) {
  return (
    <div className="hs-success" role="status">
      <div className="hs-ok"><Icon name="check" size={30} /></div>
      <h3>{title}</h3>
      <p>{text}</p>
      <button type="button" className="hs-btn hs-btn-ghost" style={{ marginTop: 16 }} onClick={again}>Send another</button>
    </div>
  );
}

// "Ask a Question": saved for the partner team, who reply by email.
export function InquiryForm({ types }: { types: TypeOption[] }) {
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const started = useRef(Date.now());
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = Object.fromEntries(new FormData(form)) as Record<string, string>;
    setStatus({ kind: "sending" });
    const r = await post("/api/partners/inquiry", { ...data, started: started.current });
    setStatus(r);
    if (r.kind === "sent") form.reset();
    else if (r.kind === "error" && r.field) form.querySelector<HTMLElement>(`[name="${r.field}"]`)?.focus();
  }
  if (status.kind === "sent") return <Done title="Thanks, we have your question" text="We sent a confirmation to your email. Our partner team will reply within one working day." again={() => { started.current = Date.now(); setStatus({ kind: "idle" }); }} />;
  const err = status.kind === "error" ? status : null;
  const bad = (f: string) => (err?.field === f ? true : undefined);
  return (
    <form className="hs-form" onSubmit={submit} aria-describedby={err ? "pq-error" : undefined}>
      <div className="hs-form-row">
        <div className="hs-field"><label htmlFor="pq-name">Your name</label><input id="pq-name" name="name" className="hs-input" required minLength={2} maxLength={120} autoComplete="name" aria-invalid={bad("name")} /></div>
        <div className="hs-field"><label htmlFor="pq-email">Email</label><input id="pq-email" name="email" type="email" className="hs-input" required maxLength={200} autoComplete="email" aria-invalid={bad("email")} /></div>
      </div>
      <div className="hs-form-row">
        <div className="hs-field"><label htmlFor="pq-phone">Phone or WhatsApp</label><input id="pq-phone" name="phone" type="tel" className="hs-input" required maxLength={40} autoComplete="tel" aria-invalid={bad("phone")} /></div>
        <div className="hs-field"><label htmlFor="pq-profession">Profession <span className="opt">(optional)</span></label><input id="pq-profession" name="profession" className="hs-input" maxLength={120} /></div>
      </div>
      <div className="hs-form-row">
        <div className="hs-field"><label htmlFor="pq-city">City <span className="opt">(optional)</span></label><input id="pq-city" name="city" className="hs-input" maxLength={80} autoComplete="address-level2" /></div>
        <div className="hs-field"><label htmlFor="pq-country">Country <span className="opt">(optional)</span></label><input id="pq-country" name="country" className="hs-input" maxLength={80} autoComplete="country-name" /></div>
      </div>
      <div className="hs-field">
        <label htmlFor="pq-type">Which partner type interests you?</label>
        <select id="pq-type" name="interestedType" className="hs-input" defaultValue="NOT_SURE">
          {types.map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}
          <option value="NOT_SURE">Not sure yet</option>
        </select>
      </div>
      <div className="hs-field"><label htmlFor="pq-message">Your question</label><textarea id="pq-message" name="message" className="hs-input" required minLength={5} maxLength={2000} aria-invalid={bad("message")} /></div>
      <Trap id="pq-website" />
      {err && <p id="pq-error" className="hs-alert hs-alert-error" role="alert">{err.message}</p>}
      <button type="submit" className="hs-btn" disabled={status.kind === "sending"}>{status.kind === "sending" ? "Sending…" : <>Ask our team <Icon name="arrow" size={16} /></>}</button>
      <p className="hs-hint">We use your details only to reply to you.</p>
    </form>
  );
}

// "Become a Partner": the application the partner team reviews.
export function ApplicationForm({ types, solutions, terms }: { types: TypeOption[]; solutions: SolutionOption[]; terms: string }) {
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [kind, setKind] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const started = useRef(Date.now());
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = Object.fromEntries(new FormData(form)) as Record<string, string>;
    setStatus({ kind: "sending" });
    const r = await post("/api/partners/apply", { ...data, solutionCodes: picked, terms: data.terms === "on", started: started.current });
    setStatus(r);
    if (r.kind === "sent") { form.reset(); setKind(""); setPicked([]); }
    else if (r.kind === "error" && r.field) form.querySelector<HTMLElement>(`[name="${r.field}"]`)?.focus();
  }
  if (status.kind === "sent") return <Done title="Your application is in" text="We emailed you a confirmation. Our partner team reviews every application and will email you the decision, usually within three working days." again={() => { started.current = Date.now(); setStatus({ kind: "idle" }); }} />;
  const err = status.kind === "error" ? status : null;
  const bad = (f: string) => (err?.field === f ? true : undefined);
  return (
    <form className="hs-form" onSubmit={submit} aria-describedby={err ? "pa-error" : undefined}>
      <div className="hs-form-row">
        <div className="hs-field"><label htmlFor="pa-name">Full name</label><input id="pa-name" name="name" className="hs-input" required minLength={2} maxLength={120} autoComplete="name" aria-invalid={bad("name")} /></div>
        <div className="hs-field"><label htmlFor="pa-email">Email</label><input id="pa-email" name="email" type="email" className="hs-input" required maxLength={200} autoComplete="email" aria-invalid={bad("email")} /></div>
      </div>
      <div className="hs-form-row">
        <div className="hs-field"><label htmlFor="pa-phone">Phone or WhatsApp</label><input id="pa-phone" name="phone" type="tel" className="hs-input" required maxLength={40} autoComplete="tel" aria-invalid={bad("phone")} /></div>
        <div className="hs-field"><label htmlFor="pa-type">Apply as</label>
          <select id="pa-type" name="typeKey" className="hs-input" required defaultValue="" aria-invalid={bad("typeKey")}>
            <option value="" disabled>Choose a partner type</option>
            {types.map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}
            <option value="NOT_SURE">Not sure yet</option>
          </select></div>
      </div>
      <div className="hs-form-row">
        <div className="hs-field"><label htmlFor="pa-city">City</label><input id="pa-city" name="city" className="hs-input" required maxLength={80} autoComplete="address-level2" aria-invalid={bad("city")} /></div>
        <div className="hs-field"><label htmlFor="pa-country">Country</label><input id="pa-country" name="country" className="hs-input" required maxLength={80} autoComplete="country-name" aria-invalid={bad("country")} /></div>
      </div>
      <div className="hs-field">
        <label htmlFor="pa-prof">Profession</label>
        <select id="pa-prof" name="professionKind" className="hs-input" required value={kind} onChange={(e) => setKind(e.target.value)} aria-invalid={bad("professionKind")}>
          <option value="" disabled>Choose one</option>
          {PROFESSIONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </div>
      {kind === "EMPLOYED" && (
        <div className="hs-form-row">
          <div className="hs-field"><label htmlFor="pa-company">Company</label><input id="pa-company" name="company" className="hs-input" required maxLength={160} autoComplete="organization" aria-invalid={bad("company")} /></div>
          <div className="hs-field"><label htmlFor="pa-title">Job title</label><input id="pa-title" name="jobTitle" className="hs-input" required maxLength={120} autoComplete="organization-title" aria-invalid={bad("jobTitle")} /></div>
        </div>
      )}
      {kind === "OTHER" && <div className="hs-field"><label htmlFor="pa-other">What do you do?</label><input id="pa-other" name="professionOther" className="hs-input" required maxLength={160} aria-invalid={bad("professionOther")} /></div>}
      <fieldset className="hs-field hs-fieldset" aria-invalid={bad("solutionCodes")}>
        <legend className="hs-label">Solutions you want to sell</legend>
        <div className="hs-checks">
          {solutions.map((s) => (
            <label key={s.code} className="hs-check">
              <input type="checkbox" checked={picked.includes(s.code)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, s.code] : p.filter((c) => c !== s.code)))} />
              <span>{s.name}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="hs-field"><label htmlFor="pa-exp">Sales experience <span className="opt">(optional)</span></label><textarea id="pa-exp" name="salesExperience" className="hs-input" style={{ minHeight: 96 }} maxLength={1500} placeholder="Tell us what you have sold before, if anything." /></div>
      <div className="hs-field"><label htmlFor="pa-net">Your network <span className="opt">(optional)</span></label><input id="pa-net" name="networkSize" className="hs-input" maxLength={300} placeholder="For example: 40 pharmacy owners in Lahore, a 2,000-member group" /></div>
      <details className="hs-terms"><summary>Read the partner terms</summary><pre>{terms}</pre></details>
      <label className="hs-check" aria-invalid={bad("terms")}><input type="checkbox" name="terms" required /><span>I have read and accept the partner terms, and the information above is true.</span></label>
      <Trap id="pa-website" />
      {err && <p id="pa-error" className="hs-alert hs-alert-error" role="alert">{err.message}</p>}
      <button type="submit" className="hs-btn" disabled={status.kind === "sending"}>{status.kind === "sending" ? "Sending…" : <>Submit my application <Icon name="arrow" size={16} /></>}</button>
      <p className="hs-hint">Applying is free. We review every application by hand.</p>
    </form>
  );
}
