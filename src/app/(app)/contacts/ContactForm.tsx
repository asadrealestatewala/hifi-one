"use client";

import Link from "next/link";
import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import Icon from "@/components/shell/Icon";
import { checkDuplicatesAction, createContactAction, updateContactAction, type FormState } from "./actions";

type Entry = { type: string; value: string };
export type Initial = {
  id?: string; kind: "PERSON" | "ORGANIZATION"; title?: string | null; firstName?: string | null; lastName?: string | null; name?: string | null; parentName?: string | null; category?: string; industry?: string | null; jobTitle?: string | null;
  ownerId?: string | null; followers?: string[]; website?: string | null; phones?: Entry[]; emails?: Entry[]; addressLine?: string | null; city?: string | null; state?: string | null; country?: string | null; postalCode?: string | null;
  timezone?: string | null; preferredContact?: string | null; source?: string | null; campaignId?: string | null; tags?: string[]; notes?: string | null; customFields?: Record<string, string>;
  birthday?: string | null; taxId?: string | null; shipAddressLine?: string | null; shipCity?: string | null; shipState?: string | null; shipCountry?: string | null; shipPostalCode?: string | null;
  social?: Record<string, string>; utm?: Record<string, string>;
};
type Opt = { id: string; name: string };

const INDUSTRIES = ["Retail", "Real estate", "Healthcare", "Education", "Hospitality", "Finance", "Technology", "Manufacturing", "Construction", "Food & beverage", "Automotive", "Non-profit", "Professional services", "E-commerce", "Media & entertainment"];
const SOURCES = ["Facebook", "Instagram", "LinkedIn", "Referral", "Website form", "Cold calling", "Email campaign", "Advertising", "Imported list", "Event", "Other"];
const CATEGORIES: [string, string][] = [["LEAD", "Lead"], ["CUSTOMER", "Customer"], ["PARTNER", "Partner"], ["VENDOR", "Vendor"], ["INVESTOR", "Investor"], ["OTHER", "Other"]];

function Section({ title, hint, open = true, children }: { title: string; hint?: string; open?: boolean; children: React.ReactNode }) {
  return (
    <details open={open} className="group rounded-2xl border border-border bg-surface">
      <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3">
        <span><span className="text-sm font-semibold">{title}</span>{hint && <span className="ml-2 text-xs text-muted">{hint}</span>}</span>
        <Icon name="chevron" className="h-4 w-4 text-muted transition group-open:rotate-90" />
      </summary>
      <div className="grid gap-3 border-t border-border p-4 sm:grid-cols-2">{children}</div>
    </details>
  );
}
const F = ({ label, id, children, wide }: { label: string; id: string; children: React.ReactNode; wide?: boolean }) => (<div className={wide ? "sm:col-span-2" : ""}><label className="label" htmlFor={id}>{label}</label>{children}</div>);

export default function ContactForm({ mode, initial, staff, orgs, campaigns, stages, me, canAssign }: {
  mode: "create" | "edit"; initial: Initial; staff: Opt[]; orgs: string[]; campaigns: Opt[]; stages: Opt[]; me: string; canAssign: boolean;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(mode === "create" ? createContactAction : updateContactAction, {});
  const [kind, setKind] = useState<"PERSON" | "ORGANIZATION">(initial.kind);
  const [phones, setPhones] = useState<Entry[]>(initial.phones?.length ? initial.phones : [{ type: "WORK", value: "" }]);
  const [emails, setEmails] = useState<Entry[]>(initial.emails?.length ? initial.emails : [{ type: "WORK", value: "" }]);
  const [tags, setTags] = useState<string[]>(initial.tags ?? []);
  const [tagDraft, setTagDraft] = useState("");
  const [fields, setFields] = useState<[string, string][]>(Object.entries(initial.customFields ?? {}));
  const [opp, setOpp] = useState(false);
  const [vals, setVals] = useState({ first: initial.firstName ?? "", last: initial.lastName ?? "", org: initial.name ?? "", parent: initial.parentName ?? "", website: initial.website ?? "", city: initial.city ?? "", industry: initial.industry ?? "", source: initial.source ?? "", notes: initial.notes ?? "" });
  const [dup, setDup] = useState<{ duplicates: { id: string; name: string; email: string | null; phone: string | null }[]; hidden: number } | null>(null);
  const addAnother = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showDup = state.duplicates?.length ? { duplicates: state.duplicates, hidden: 0 } : dup;

  // Live duplicate check while typing an email, phone or organization name
  const firstEmail = emails[0]?.value ?? "", firstPhone = phones[0]?.value ?? "";
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!firstEmail && !firstPhone && !(kind === "ORGANIZATION" && vals.org.length > 2)) { setDup(null); return; }
    timer.current = setTimeout(async () => { try { const r = await checkDuplicatesAction(firstEmail, firstPhone, kind, vals.org, initial.id); setDup(r.duplicates.length || r.hidden ? r : null); } catch { setDup(null); } }, 500);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [firstEmail, firstPhone, kind, vals.org, initial.id]);

  // A friendly completeness meter: more filled in, more useful, more XP
  const filled = useMemo(() => {
    const checks = [kind === "ORGANIZATION" ? vals.org : vals.first, emails.some((e) => e.value.trim()), phones.some((p) => p.value.trim()), vals.parent || kind === "ORGANIZATION", vals.industry, vals.city, vals.source, tags.length > 0, vals.website, vals.notes];
    return Math.round((checks.filter(Boolean).length / checks.length) * 100);
  }, [kind, vals, emails, phones, tags]);

  const addTag = () => { const t = tagDraft.trim().toLowerCase().slice(0, 30); if (t && !tags.includes(t) && tags.length < 12) setTags([...tags, t]); setTagDraft(""); };
  const upd = (set: typeof setPhones, list: Entry[], i: number, patch: Partial<Entry>) => set(list.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  return (
    <form action={action} className="flex h-full flex-col">
      {initial.id && <input type="hidden" name="id" value={initial.id} />}
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="tags" value={tags.join(",")} />
      <input ref={addAnother} type="hidden" name="addAnother" defaultValue="0" />

      <div className="flex-1 space-y-4 overflow-y-auto px-5 pb-6 pt-4">
        {mode === "create" && (
          <div className="grid grid-cols-2 gap-1 rounded-xl bg-hover p-1 text-sm" role="tablist" aria-label="What are you adding?">
            {(["PERSON", "ORGANIZATION"] as const).map((k) => (
              <button key={k} type="button" role="tab" aria-selected={kind === k} onClick={() => setKind(k)} className={`flex items-center justify-center gap-2 rounded-lg py-2 font-medium transition ${kind === k ? "bg-surface shadow-sm" : "text-muted hover:text-foreground"}`}>
                <Icon name={k === "PERSON" ? "user" : "building"} className="h-4 w-4" />{k === "PERSON" ? "Contact" : "Organization"}
              </button>
            ))}
          </div>
        )}

        <div aria-live="polite" className="space-y-1">
          <div className="flex items-center justify-between text-xs"><span className="text-muted">Profile completeness</span><span className="font-semibold text-primary">{filled}%{filled === 100 ? " · complete!" : mode === "create" ? ` · +${Math.round(filled / 10)} bonus XP` : ""}</span></div>
          <div className="h-2 overflow-hidden rounded-full bg-hover"><div className="h-full rounded-full bg-gradient-to-r from-primary to-accent transition-all duration-500" style={{ width: `${filled}%` }} /></div>
        </div>

        {state.error && (
          <div role="alert" className="rounded-xl bg-brand/10 px-4 py-3 text-sm text-brand">{state.error}</div>
        )}
        {showDup && (
          <div className="space-y-2 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
            <p className="font-medium text-warning">Possible duplicate{showDup.duplicates.length === 1 ? "" : "s"}</p>
            <ul className="space-y-1">{showDup.duplicates.map((d) => <li key={d.id}><Link href={`/contacts/${d.id}`} target="_blank" className="font-medium underline">{d.name}</Link> <span className="text-xs text-muted">{[d.email, d.phone].filter(Boolean).join(" · ")}</span></li>)}</ul>
            {showDup.hidden > 0 && <p className="text-xs text-muted">{showDup.hidden} more match{showDup.hidden === 1 ? "es" : ""} belong to colleagues.</p>}
            {mode === "create" && <label className="flex items-center gap-2 text-xs"><input type="checkbox" name="confirmDuplicate" /> Create it anyway, I have checked</label>}
          </div>
        )}

        <Section title="Basics">
          {kind === "PERSON" ? (
            <>
              <F label="Title" id="f-title"><select id="f-title" name="title" defaultValue={initial.title ?? ""} className="input"><option value="">Not set</option>{["Mr", "Ms", "Mrs", "Dr", "Eng", "Prof"].map((t) => <option key={t}>{t}</option>)}</select></F>
              <F label="Category" id="f-cat"><select id="f-cat" name="category" defaultValue={initial.category ?? "LEAD"} className="input">{CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></F>
              <F label="First name *" id="f-first"><input id="f-first" name="firstName" value={vals.first} onChange={(e) => setVals({ ...vals, first: e.target.value })} maxLength={80} autoFocus className="input" required={kind === "PERSON" && !vals.last} /></F>
              <F label="Last name" id="f-last"><input id="f-last" name="lastName" value={vals.last} onChange={(e) => setVals({ ...vals, last: e.target.value })} maxLength={80} className="input" /></F>
              <F label="Organization" id="f-parent" wide>
                <input id="f-parent" name="parentName" list="orgs" value={vals.parent} onChange={(e) => setVals({ ...vals, parent: e.target.value })} placeholder="Choose, or type a new company name" className="input" autoComplete="off" />
                <datalist id="orgs">{orgs.map((o) => <option key={o} value={o} />)}</datalist>
                {vals.parent.trim() && !orgs.some((o) => o.toLowerCase() === vals.parent.trim().toLowerCase()) && <p className="mt-1 text-xs text-primary">A new organization “{vals.parent.trim()}” will be created and linked.</p>}
              </F>
              <F label="Job title" id="f-job"><input id="f-job" name="jobTitle" defaultValue={initial.jobTitle ?? ""} maxLength={80} className="input" /></F>
              <F label="Industry" id="f-ind"><input id="f-ind" name="industry" list="industries" value={vals.industry} onChange={(e) => setVals({ ...vals, industry: e.target.value })} className="input" /></F>
            </>
          ) : (
            <>
              <F label="Organization name *" id="f-org" wide><input id="f-org" name="orgName" value={vals.org} onChange={(e) => setVals({ ...vals, org: e.target.value })} maxLength={160} autoFocus required className="input" /></F>
              <F label="Category" id="f-cat2"><select id="f-cat2" name="category" defaultValue={initial.category ?? "LEAD"} className="input">{CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></F>
              <F label="Industry" id="f-ind2"><input id="f-ind2" name="industry" list="industries" value={vals.industry} onChange={(e) => setVals({ ...vals, industry: e.target.value })} className="input" /></F>
            </>
          )}
          <datalist id="industries">{INDUSTRIES.map((i) => <option key={i} value={i} />)}</datalist>
          <F label="Assignee" id="f-owner">
            {canAssign ? <select id="f-owner" name="ownerId" defaultValue={initial.ownerId ?? me} className="input">{staff.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
              : <><input type="hidden" name="ownerId" value={initial.ownerId ?? me} /><input readOnly value={staff.find((u) => u.id === (initial.ownerId ?? me))?.name ?? "You"} className="input" aria-label="Assignee" /></>}
          </F>
          <F label="Followers" id="f-fol">
            <details className="relative"><summary className="input cursor-pointer list-none text-sm text-muted">Pick people who should be kept in the loop</summary>
              <div className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-xl border border-border bg-surface p-2 shadow-lg">{staff.map((u) => <label key={u.id} className="flex items-center gap-2 rounded-lg px-2 py-1 text-sm hover:bg-hover"><input type="checkbox" name="followers" value={u.id} defaultChecked={initial.followers?.includes(u.id)} />{u.name}</label>)}</div>
            </details>
          </F>
        </Section>

        <Section title="Phone & email" hint="add as many as you need">
          <div className="space-y-2 sm:col-span-1">
            <p className="label">Phone numbers</p>
            {phones.map((p, i) => (
              <div key={i} className="flex gap-2">
                <input name="phoneValue" value={p.value} onChange={(e) => upd(setPhones, phones, i, { value: e.target.value })} inputMode="tel" placeholder="+92 316 8080801" aria-label={`Phone ${i + 1}`} className="input" />
                <select name="phoneType" value={p.type} onChange={(e) => upd(setPhones, phones, i, { type: e.target.value })} aria-label={`Phone ${i + 1} type`} className="input !w-28">{["WORK", "MOBILE", "HOME", "WHATSAPP", "OTHER"].map((t) => <option key={t} value={t}>{t.charAt(0) + t.slice(1).toLowerCase()}</option>)}</select>
                {phones.length > 1 && <button type="button" onClick={() => setPhones(phones.filter((_, j) => j !== i))} className="px-1 text-muted hover:text-brand" aria-label="Remove phone">×</button>}
              </div>
            ))}
            {phones.length < 10 && <button type="button" onClick={() => setPhones([...phones, { type: "MOBILE", value: "" }])} className="text-sm font-medium text-primary">+ Add phone</button>}
          </div>
          <div className="space-y-2">
            <p className="label">Email addresses</p>
            {emails.map((p, i) => (
              <div key={i} className="flex gap-2">
                <input name="emailValue" type="email" value={p.value} onChange={(e) => upd(setEmails, emails, i, { value: e.target.value })} placeholder="name@company.com" aria-label={`Email ${i + 1}`} className="input" />
                <select name="emailType" value={p.type} onChange={(e) => upd(setEmails, emails, i, { type: e.target.value })} aria-label={`Email ${i + 1} type`} className="input !w-28">{["WORK", "PERSONAL", "BILLING", "OTHER"].map((t) => <option key={t} value={t}>{t.charAt(0) + t.slice(1).toLowerCase()}</option>)}</select>
                {emails.length > 1 && <button type="button" onClick={() => setEmails(emails.filter((_, j) => j !== i))} className="px-1 text-muted hover:text-brand" aria-label="Remove email">×</button>}
              </div>
            ))}
            {emails.length < 10 && <button type="button" onClick={() => setEmails([...emails, { type: "PERSONAL", value: "" }])} className="text-sm font-medium text-primary">+ Add email</button>}
          </div>
          <F label="Website" id="f-web" wide><input id="f-web" name="website" value={vals.website} onChange={(e) => setVals({ ...vals, website: e.target.value })} placeholder="https://" className="input" /></F>
          <F label="Preferred way to reach them" id="f-pc"><select id="f-pc" name="preferredContact" defaultValue={initial.preferredContact ?? ""} className="input"><option value="">No preference</option>{["CALL", "WHATSAPP", "EMAIL", "SMS"].map((c) => <option key={c} value={c}>{c.toLowerCase()}</option>)}</select></F>
          <F label="Time zone" id="f-tz"><input id="f-tz" name="timezone" defaultValue={initial.timezone ?? ""} placeholder="Asia/Karachi" className="input" /></F>
        </Section>

        <Section title="Address" open={Boolean(initial.city || initial.addressLine)}>
          <F label="Street address" id="f-addr" wide><input id="f-addr" name="addressLine" defaultValue={initial.addressLine ?? ""} className="input" /></F>
          <F label="City" id="f-city"><input id="f-city" name="city" value={vals.city} onChange={(e) => setVals({ ...vals, city: e.target.value })} className="input" /></F>
          <F label="State / region" id="f-state"><input id="f-state" name="state" defaultValue={initial.state ?? ""} className="input" /></F>
          <F label="Country" id="f-country"><input id="f-country" name="country" defaultValue={initial.country ?? ""} className="input" /></F>
          <F label="Postal code" id="f-zip"><input id="f-zip" name="postalCode" defaultValue={initial.postalCode ?? ""} className="input" /></F>
        </Section>

        <Section title="CRM details" hint="source, campaign, tags">
          <F label="Source" id="f-src"><input id="f-src" name="source" list="sources" value={vals.source} onChange={(e) => setVals({ ...vals, source: e.target.value })} className="input" /><datalist id="sources">{SOURCES.map((x) => <option key={x} value={x} />)}</datalist></F>
          <F label="Campaign" id="f-camp"><select id="f-camp" name="campaignId" defaultValue={initial.campaignId ?? ""} className="input"><option value="">None</option>{campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></F>
          <F label="Tags" id="f-tag" wide>
            <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-border bg-surface p-2">
              {tags.map((t) => <span key={t} className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">{t}<button type="button" onClick={() => setTags(tags.filter((x) => x !== t))} aria-label={`Remove tag ${t}`}>×</button></span>)}
              <input id="f-tag" value={tagDraft} onChange={(e) => setTagDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addTag(); } }} onBlur={addTag} placeholder={tags.length ? "" : "Type a tag, press Enter"} className="min-w-24 flex-1 bg-transparent px-1 text-sm outline-none" />
            </div>
          </F>
        </Section>

        {mode === "create" && (
          <Section title="Sales opportunity" hint="shows up on the pipeline board" open={false}>
            <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" name="openOpportunity" checked={opp} onChange={(e) => setOpp(e.target.checked)} /> Open an opportunity for this {kind === "PERSON" ? "contact" : "organization"}</label>
            {opp && (<>
              <F label="Expected value" id="f-dv"><input id="f-dv" name="dealValue" inputMode="decimal" className="input" /></F>
              <F label="Currency" id="f-cur"><select id="f-cur" name="currency" defaultValue="USD" className="input">{["PKR", "USD", "AED", "GBP"].map((c) => <option key={c}>{c}</option>)}</select></F>
              <F label="Service of interest" id="f-svc"><input id="f-svc" name="serviceInterest" className="input" placeholder="e.g. Social media management" /></F>
              <F label="Pipeline stage" id="f-stage"><select id="f-stage" name="stageId" className="input" defaultValue="">{[{ id: "", name: "First stage" }, ...stages].map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></F>
              <F label="Expected closing date" id="f-close"><input id="f-close" name="expectedCloseDate" type="date" className="input" /></F>
            </>)}
          </Section>
        )}

        <Section title="More details" hint="birthday, tax ID, shipping address, social, campaign tracking" open={false}>
          <F label="Birthday" id="f-bd"><input id="f-bd" name="birthday" type="date" defaultValue={initial.birthday ?? ""} className="input" /></F>
          <F label="Tax ID" id="f-tax"><input id="f-tax" name="taxId" defaultValue={initial.taxId ?? ""} maxLength={40} className="input" /></F>
          <p className="label sm:col-span-2">Shipping address <span className="font-normal text-muted">(leave empty if the same as the address above)</span></p>
          <F label="Street address" id="f-sa" wide><input id="f-sa" name="shipAddressLine" defaultValue={initial.shipAddressLine ?? ""} className="input" /></F>
          <F label="City" id="f-sc"><input id="f-sc" name="shipCity" defaultValue={initial.shipCity ?? ""} className="input" /></F>
          <F label="State / region" id="f-ss"><input id="f-ss" name="shipState" defaultValue={initial.shipState ?? ""} className="input" /></F>
          <F label="Country" id="f-sco"><input id="f-sco" name="shipCountry" defaultValue={initial.shipCountry ?? ""} className="input" /></F>
          <F label="Postal code" id="f-sz"><input id="f-sz" name="shipPostalCode" defaultValue={initial.shipPostalCode ?? ""} className="input" /></F>
          <p className="label sm:col-span-2">Social profiles</p>
          {["facebook", "linkedin", "telegram", "x", "skype", "instagram"].map((k) => <F key={k} label={k === "x" ? "X" : k.charAt(0).toUpperCase() + k.slice(1)} id={`f-so-${k}`}><input id={`f-so-${k}`} name={`social_${k}`} defaultValue={initial.social?.[k] ?? ""} maxLength={200} className="input" /></F>)}
          <p className="label sm:col-span-2">Campaign tracking (UTM)</p>
          {["source", "medium", "campaign", "term", "content"].map((k) => <F key={k} label={`UTM ${k}`} id={`f-utm-${k}`}><input id={`f-utm-${k}`} name={`utm_${k}`} defaultValue={initial.utm?.[k] ?? ""} maxLength={100} className="input" /></F>)}
        </Section>

        <Section title="Notes & custom fields" open={Boolean(initial.notes || fields.length)}>
          <F label="Notes" id="f-notes" wide><textarea id="f-notes" name="notes" rows={3} maxLength={4000} value={vals.notes} onChange={(e) => setVals({ ...vals, notes: e.target.value })} className="input" /></F>
          <div className="space-y-2 sm:col-span-2">
            <p className="label">Custom fields</p>
            {fields.map(([k, v], i) => (
              <div key={i} className="flex gap-2"><input name="cfKey" value={k} onChange={(e) => setFields(fields.map((f, j) => (j === i ? [e.target.value, f[1]] : f)))} placeholder="Field (e.g. Birthday)" aria-label="Field name" className="input" /><input name="cfValue" value={v} onChange={(e) => setFields(fields.map((f, j) => (j === i ? [f[0], e.target.value] : f)))} placeholder="Value" aria-label="Field value" className="input" /><button type="button" onClick={() => setFields(fields.filter((_, j) => j !== i))} className="px-1 text-muted hover:text-brand" aria-label="Remove field">×</button></div>
            ))}
            {fields.length < 20 && <button type="button" onClick={() => setFields([...fields, ["", ""]])} className="text-sm font-medium text-primary">+ Add a field</button>}
          </div>
        </Section>
      </div>

      <div className="flex items-center gap-3 border-t border-border bg-surface px-5 py-3">
        <button className="btn" disabled={pending}>{pending ? "Saving…" : mode === "create" ? "Save" : "Save changes"}</button>
        {mode === "create" && <button className="btn-ghost" disabled={pending} onClick={() => { if (addAnother.current) addAnother.current.value = "1"; }}>Save &amp; add another</button>}
        <Link href={mode === "create" ? "/contacts" : `/contacts/${initial.id}`} className="ml-auto text-sm text-muted hover:text-foreground">Cancel</Link>
      </div>
    </form>
  );
}
