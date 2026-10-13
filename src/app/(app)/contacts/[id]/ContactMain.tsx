import Link from "next/link";
import type { Contact } from "@prisma/client";
import Icon from "@/components/shell/Icon";
import { Avatar, Badge } from "@/components/ui";
import type { Entry } from "@/lib/crm-contacts";
import EditableSection from "../EditableSection";
import { EntryEditor, PairsEditor, ShippingFields } from "../Editors";

const CATS: [string, string][] = [["LEAD", "Lead"], ["CUSTOMER", "Customer"], ["PARTNER", "Partner"], ["VENDOR", "Vendor"], ["INVESTOR", "Investor"], ["OTHER", "Other"]];
const SOCIAL: [string, string][] = [["facebook", "Facebook"], ["linkedin", "LinkedIn"], ["telegram", "Telegram"], ["x", "X"], ["skype", "Skype"], ["instagram", "Instagram"]];
const UTM = ["source", "medium", "campaign", "term", "content"];
const TONE: Record<string, "success" | "primary" | "warning" | "neutral"> = { CUSTOMER: "success", LEAD: "primary", PARTNER: "warning" };

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div><dt className="text-xs text-muted">{label}</dt><dd className="text-sm">{children ?? <span className="text-muted">Not set</span>}</dd></div>
);
const Block = ({ children }: { children: React.ReactNode }) => <div className="border-t border-border py-5 first:border-0 first:pt-0">{children}</div>;
const link = (v: string | null) => (v ? (/^https?:\/\//.test(v) ? <a className="text-primary hover:underline" href={v} target="_blank" rel="noopener noreferrer">{v}</a> : v) : null);
const social = (k: string, v: string) => (k === "skype" || k === "x" && !v.startsWith("http") ? v : /^https?:\/\//.test(v) ? link(v) : v);

export default function ContactMain({ c, parent, people, staff, owners, followerNames, orgs, canEdit, manager, right }: {
  c: Contact; parent: { id: string; name: string; primaryEmail: string | null; primaryPhone: string | null } | null; people: number; staff: { id: string; name: string }[]; owners: Map<string, string>;
  followerNames: { id: string; name: string }[]; orgs: string[]; canEdit: boolean; manager: boolean; right: React.ReactNode;
}) {
  const phones = c.phones as unknown as Entry[], emails = c.emails as unknown as Entry[];
  const soc = c.social as Record<string, string>, utm = c.utm as Record<string, string>, custom = c.customFields as Record<string, string>;
  const billing = { addressLine: c.addressLine ?? "", city: c.city ?? "", state: c.state ?? "", country: c.country ?? "", postalCode: c.postalCode ?? "" };
  const addr = (a: { addressLine?: string | null; city?: string | null; state?: string | null; postalCode?: string | null; country?: string | null }) => [a.addressLine, a.city, a.state, a.postalCode, a.country].filter(Boolean).join(", ") || null;
  const ship = addr({ addressLine: c.shipAddressLine, city: c.shipCity, state: c.shipState, postalCode: c.shipPostalCode, country: c.shipCountry });
  const isPerson = c.kind === "PERSON";
  const ownerName = c.ownerId ? owners.get(c.ownerId) ?? "Former staff" : null;
  const common = { contactId: c.id, canEdit };

  return (
    <div className="space-y-6">
      {/* Summary strip */}
      <EditableSection {...common} section="summary" view={
        <dl className="card grid grid-cols-2 gap-4 !p-5 sm:grid-cols-3 lg:grid-cols-5">
          <Row label="Website">{link(c.website)}</Row>
          <Row label="Birthday">{c.birthday ? new Date(c.birthday + "T00:00:00").toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : null}</Row>
          <Row label="Industry">{c.industry}</Row>
          <Row label="Category"><Badge tone={TONE[c.category] ?? "neutral"}>{c.category.toLowerCase()}</Badge></Row>
          <Row label="Owner">{ownerName ? <span className="inline-flex items-center gap-2"><Avatar name={ownerName} userId={c.ownerId} size={22} />{ownerName}</span> : null}</Row>
        </dl>
      }>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div><label className="label" htmlFor="s-web">Website</label><input id="s-web" name="website" defaultValue={c.website ?? ""} placeholder="https://" className="input" /></div>
          <div><label className="label" htmlFor="s-bd">Birthday</label><input id="s-bd" name="birthday" type="date" defaultValue={c.birthday ?? ""} className="input" /></div>
          <div><label className="label" htmlFor="s-ind">Industry</label><input id="s-ind" name="industry" defaultValue={c.industry ?? ""} className="input" /></div>
          <div><label className="label" htmlFor="s-cat">Category</label><select id="s-cat" name="category" defaultValue={c.category} className="input">{CATS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
          {manager && <div><label className="label" htmlFor="s-own">Owner</label><select id="s-own" name="ownerId" defaultValue={c.ownerId ?? ""} className="input"><option value="">Not set</option>{staff.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div>}
        </div>
      </EditableSection>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
      <div className="space-y-0 rounded-2xl border border-border bg-surface p-5">
        <Block>
          <EditableSection {...common} section="contacts" title="Contacts" view={
            <dl className="space-y-3">
              <div><dt className="text-xs text-muted">Email</dt>{emails.length === 0 ? <dd className="text-sm text-muted">Not set</dd> : emails.map((e) => <dd key={e.value} className="flex flex-wrap items-center gap-2 py-0.5 text-sm"><a className="text-primary hover:underline" href={`mailto:${e.value}`}>{e.value}</a><span className="rounded bg-hover px-1.5 py-0.5 text-xs text-muted">{e.type.toLowerCase()}</span></dd>)}</div>
              <div><dt className="text-xs text-muted">Phone</dt>{phones.length === 0 ? <dd className="text-sm text-muted">Not set</dd> : phones.map((p) => <dd key={p.value} className="flex flex-wrap items-center gap-2 py-0.5 text-sm"><a className="text-primary hover:underline" href={`tel:${p.value.replace(/[^\d+]/g, "")}`}>{p.value}</a><span className="rounded bg-hover px-1.5 py-0.5 text-xs text-muted">{p.type.toLowerCase()}</span>{(p.type === "WHATSAPP" || p.type === "MOBILE") && <a className="text-xs text-success hover:underline" href={`https://wa.me/${p.value.replace(/[^\d]/g, "")}`} target="_blank" rel="noopener noreferrer">WhatsApp</a>}</dd>)}</div>
              {(c.preferredContact || c.timezone) && <Row label="Preferred">{[c.preferredContact?.toLowerCase(), c.timezone].filter(Boolean).join(" · ")}</Row>}
            </dl>
          }>
            <EntryEditor kind="email" initial={emails} />
            <EntryEditor kind="phone" initial={phones} />
            <div className="grid gap-3 sm:grid-cols-2">
              <div><label className="label" htmlFor="c-pc">Preferred way to reach them</label><select id="c-pc" name="preferredContact" defaultValue={c.preferredContact ?? ""} className="input"><option value="">No preference</option>{["CALL", "WHATSAPP", "EMAIL", "SMS"].map((x) => <option key={x} value={x}>{x.toLowerCase()}</option>)}</select></div>
              <div><label className="label" htmlFor="c-tz">Time zone</label><input id="c-tz" name="timezone" defaultValue={c.timezone ?? ""} placeholder="Asia/Karachi" className="input" /></div>
            </div>
          </EditableSection>
        </Block>

        {isPerson && (
          <Block>
            <EditableSection {...common} section="organization" title="Organization" view={
              parent ? (
                <div className="flex items-start gap-3 rounded-2xl border border-border p-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Icon name="building" className="h-5 w-5" /></span>
                  <div className="min-w-0 flex-1 text-sm"><Link href={`/contacts/${parent.id}`} className="font-semibold hover:underline">{parent.name}</Link>{c.jobTitle && <p className="text-muted">{c.jobTitle}</p>}{parent.primaryPhone && <p className="text-muted">{parent.primaryPhone}</p>}{parent.primaryEmail && <a className="text-primary hover:underline" href={`mailto:${parent.primaryEmail}`}>{parent.primaryEmail}</a>}</div>
                  <span className="flex gap-1">{parent.primaryEmail && <a href={`mailto:${parent.primaryEmail}`} aria-label="Email the organization" className="rounded-lg p-1.5 text-muted hover:bg-hover hover:text-primary"><Icon name="mail" className="h-4 w-4" /></a>}{parent.primaryPhone && <a href={`tel:${parent.primaryPhone}`} aria-label="Call the organization" className="rounded-lg p-1.5 text-muted hover:bg-hover hover:text-primary"><Icon name="phone" className="h-4 w-4" /></a>}</span>
                </div>
              ) : <p className="text-sm text-muted">Not linked to an organization. {canEdit && "Use the pencil to add one."}</p>
            }>
              <label className="label" htmlFor="o-name">Organization</label>
              <input id="o-name" name="parentName" list="o-orgs" defaultValue={parent?.name ?? ""} placeholder="Choose, or type a new company name. Empty removes the link." className="input" autoComplete="off" />
              <datalist id="o-orgs">{orgs.map((o) => <option key={o} value={o} />)}</datalist>
            </EditableSection>
          </Block>
        )}
        {!isPerson && (
          <Block><h2 className="text-[15px] font-semibold">People</h2><p className="mt-1 text-sm text-muted">{people === 0 ? "No people linked yet. Add a contact and choose this organization as their company." : <><Link href={`/contacts/${c.id}?tab=people`} className="text-primary hover:underline">{people} {people === 1 ? "person" : "people"}</Link> work here.</>}</p></Block>
        )}

        <Block>
          <EditableSection {...common} section="followers" title="Followers" view={
            followerNames.length === 0 ? <p className="text-sm text-muted">No followers. {canEdit && "Add colleagues who should be kept in the loop."}</p> : <ul className="flex flex-wrap gap-2">{followerNames.map((f) => <li key={f.id} className="inline-flex items-center gap-2 rounded-full bg-hover py-1 pl-1 pr-3 text-sm"><Avatar name={f.name} userId={f.id} size={22} />{f.name}</li>)}</ul>
          }>
            <div className="grid max-h-48 gap-1 overflow-y-auto sm:grid-cols-2">{staff.filter((u) => u.id !== c.ownerId).map((u) => <label key={u.id} className="flex items-center gap-2 rounded-lg px-2 py-1 text-sm hover:bg-hover"><input type="checkbox" name="followers" value={u.id} defaultChecked={c.followers.includes(u.id)} />{u.name}</label>)}</div>
          </EditableSection>
        </Block>

        <Block>
          <EditableSection {...common} section="description" title="Description" view={c.notes ? <p className="whitespace-pre-line text-sm">{c.notes}</p> : <p className="text-sm text-muted">No description.</p>}>
            <textarea name="notes" rows={4} maxLength={4000} defaultValue={c.notes ?? ""} aria-label="Description" className="input" />
          </EditableSection>
          <div className="mt-3 flex flex-wrap items-center gap-2"><Link href={`/contacts/${c.id}?tab=documents`} className="btn-ghost"><Icon name="file" className="h-4 w-4" />Attach files</Link></div>
        </Block>

        <Block>
          <EditableSection {...common} section="tags" title="Tags" view={c.tags.length === 0 ? <p className="text-sm text-muted">No tags.</p> : <div className="flex flex-wrap gap-1.5">{c.tags.map((t) => <Link key={t} href={`/contacts?tag=${encodeURIComponent(t)}`}><Badge tone="primary">{t}</Badge></Link>)}</div>}>
            <label className="label" htmlFor="t-tags">Tags, separated by commas</label>
            <input id="t-tags" name="tags" defaultValue={c.tags.join(", ")} className="input" />
          </EditableSection>
        </Block>

        <Block>
          <h2 className="mb-2 text-[15px] font-semibold">Addresses</h2>
          <div className="space-y-4">
            <EditableSection {...common} section="billing" title="" view={<dl className="rounded-xl border border-border p-3"><Row label="Billing address">{addr(c)}</Row></dl>}>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2"><label className="label" htmlFor="b-a">Billing address</label><input id="b-a" name="addressLine" defaultValue={c.addressLine ?? ""} className="input" /></div>
                <div><label className="label" htmlFor="b-c">City</label><input id="b-c" name="city" defaultValue={c.city ?? ""} className="input" /></div>
                <div><label className="label" htmlFor="b-s">State / region</label><input id="b-s" name="state" defaultValue={c.state ?? ""} className="input" /></div>
                <div><label className="label" htmlFor="b-co">Country</label><input id="b-co" name="country" defaultValue={c.country ?? ""} className="input" /></div>
                <div><label className="label" htmlFor="b-z">Postal code</label><input id="b-z" name="postalCode" defaultValue={c.postalCode ?? ""} className="input" /></div>
              </div>
            </EditableSection>
            <EditableSection {...common} section="shipping" title="" view={<dl className="rounded-xl border border-border p-3"><Row label="Shipping address">{ship}</Row></dl>}>
              <ShippingFields initial={{ addressLine: c.shipAddressLine ?? "", city: c.shipCity ?? "", state: c.shipState ?? "", country: c.shipCountry ?? "", postalCode: c.shipPostalCode ?? "" }} billing={billing} />
            </EditableSection>
          </div>
        </Block>

        <Block>
          <EditableSection {...common} section="details" title="Details" view={
            <dl className="grid grid-cols-2 gap-3">
              {isPerson ? <>
                <Row label="Last name">{c.lastName}</Row><Row label="First name">{c.firstName}</Row>
                <Row label="Initials">{[c.firstName, c.lastName].filter(Boolean).map((x) => x![0]!.toUpperCase()).join("") || null}</Row><Row label="Full name">{[c.title, c.name].filter(Boolean).join(" ")}</Row>
                <Row label="Job title">{c.jobTitle}</Row>
              </> : <Row label="Organization name">{c.name}</Row>}
              <Row label="Tax ID">{c.taxId}</Row>
            </dl>
          }>
            <div className="grid gap-3 sm:grid-cols-2">
              {isPerson ? <>
                <div><label className="label" htmlFor="d-t">Title</label><select id="d-t" name="title" defaultValue={c.title ?? ""} className="input"><option value="">Not set</option>{["Mr", "Ms", "Mrs", "Dr", "Eng", "Prof"].map((t) => <option key={t}>{t}</option>)}</select></div>
                <div><label className="label" htmlFor="d-j">Job title</label><input id="d-j" name="jobTitle" defaultValue={c.jobTitle ?? ""} className="input" /></div>
                <div><label className="label" htmlFor="d-f">First name</label><input id="d-f" name="firstName" defaultValue={c.firstName ?? ""} className="input" /></div>
                <div><label className="label" htmlFor="d-l">Last name</label><input id="d-l" name="lastName" defaultValue={c.lastName ?? ""} className="input" /></div>
              </> : <div className="sm:col-span-2"><label className="label" htmlFor="d-o">Organization name</label><input id="d-o" name="orgName" defaultValue={c.name} required className="input" /></div>}
              <div><label className="label" htmlFor="d-x">Tax ID</label><input id="d-x" name="taxId" defaultValue={c.taxId ?? ""} maxLength={40} className="input" /></div>
            </div>
          </EditableSection>
        </Block>

        <Block>
          <EditableSection {...common} section="more" title="More" view={
            <dl className="grid grid-cols-2 gap-3">
              <Row label="Type">{isPerson ? "Contact" : "Organization"}</Row><Row label="Source">{c.source}</Row>
              {SOCIAL.map(([k, l]) => <Row key={k} label={l}>{soc[k] ? social(k, soc[k]) : null}</Row>)}
              <div className="col-span-2"><details className="group"><summary className="flex cursor-pointer list-none items-center justify-between text-xs text-muted">UTM tags<Icon name="down" className="h-4 w-4 transition group-open:rotate-180" /></summary>
                <dl className="mt-2 grid grid-cols-2 gap-3">{UTM.map((k) => <Row key={k} label={`UTM ${k}`}>{utm[k]}</Row>)}</dl></details></div>
            </dl>
          }>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2"><label className="label" htmlFor="m-src">Source</label><input id="m-src" name="source" defaultValue={c.source ?? ""} placeholder="e.g. LinkedIn, referral" className="input" /></div>
              {SOCIAL.map(([k, l]) => <div key={k}><label className="label" htmlFor={`m-${k}`}>{l}</label><input id={`m-${k}`} name={`social_${k}`} defaultValue={soc[k] ?? ""} maxLength={200} className="input" /></div>)}
              {UTM.map((k) => <div key={k}><label className="label" htmlFor={`mu-${k}`}>UTM {k}</label><input id={`mu-${k}`} name={`utm_${k}`} defaultValue={utm[k] ?? ""} maxLength={100} className="input" /></div>)}
            </div>
          </EditableSection>
        </Block>

        <Block>
          <EditableSection {...common} section="custom" title="Custom fields" view={
            Object.keys(custom).length === 0 ? <p className="text-sm text-muted">No custom fields. {canEdit && "Use the pencil to add your own, like Repeat customer or Best contact method."}</p> : <dl className="grid grid-cols-2 gap-3">{Object.entries(custom).map(([k, v]) => <Row key={k} label={k}>{v}</Row>)}</dl>
          }>
            <PairsEditor initial={custom} />
          </EditableSection>
        </Block>
      </div>
      <div>{right}</div>
      </div>
    </div>
  );
}
