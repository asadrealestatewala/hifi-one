import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { isConfigured } from "@/lib/integration-keys";
import { googleCaps, usage } from "@/lib/api-budget";
import { pageSpeedUsage } from "@/lib/website-checks";
import { socialUsage } from "@/lib/prospect-social";
import { BAND_LABEL, SERVICES, scoreProspect, type ProspectScore } from "@/lib/prospect-score";
import { inputFor } from "@/lib/prospect-scoring";
import { PROSPECT_SORTS, PROSPECT_STATUSES, RESULT_CHOICES, assignableAgents, canSearch, dailyLimitFor, estimate, isManager, prospectWhere, searchesToday } from "@/lib/prospector";
import { callingCodeOptions, countryOptions } from "@/lib/phone";
import { usersWithPermission } from "@/lib/notifications";
import { orderFor } from "@/lib/sort";
import { listHref, parseListParams } from "@/lib/list-params";
import { CHANNELS, CHANNEL_LABEL, OUTCOME_LABEL, OUTCOMES, RESULTS, RESULT_LABEL } from "@/lib/prospect-crm";
import { MANUAL_SOURCE_LABEL } from "@/lib/prospect-manual";
import { getPolicy } from "@/lib/lead-duplicates";
import { Badge, Chips, DateFilterBar, Empty, Notice, PageHeader, Pager, SearchBox, SubmitButton } from "@/components/ui";
import { checkWebsites, claimProspectAction, getFacebookData, reviewProspects, saveFacebookLink, saveSearchLimits, logProspectContact, removeOwnProspectAction, searchProspects, updateScores } from "./actions";
import AutoRefresh from "./AutoRefresh";
import AddProspect from "./AddProspect";
import ImportProspects from "./ImportProspects";
import ConfirmButton from "@/components/ui/ConfirmButton";

const LABEL: Record<string, string> = { NEW: "New", REVIEWED: "Reviewed", ASSIGNED: "Assigned", CONTACTED: "Contacted", NOT_INTERESTED: "Not interested", SENT_TO_CRM: "Converted", DISMISSED: "Dismissed" };
const TONE: Record<string, "primary" | "warning" | "success" | "neutral"> = { NEW: "primary", REVIEWED: "warning", ASSIGNED: "primary", CONTACTED: "primary", NOT_INTERESTED: "warning", SENT_TO_CRM: "success", DISMISSED: "neutral" };
const usd = (n: number) => `$${n.toFixed(2)}`;

const BAND_TONE: Record<ProspectScore["band"], "success" | "primary" | "warning" | "neutral"> = { STRONG: "success", GOOD: "primary", SOME: "warning", WEAK: "neutral" };

// How big an opportunity the business is (see src/lib/prospect-score.ts): the score, the service to lead with, why, and a note for the call
function ScoreCell({ s }: { s: ProspectScore }) {
  return (
    <div className="max-w-[16rem] space-y-1">
      <div className="flex flex-wrap items-center gap-1">
        <Badge tone={BAND_TONE[s.band]}>{s.score} of 100</Badge>
        {s.topService && <span className="text-xs text-muted">{SERVICES[s.topService].label}</span>}
      </div>
      <details className="text-xs text-muted">
        <summary className="cursor-pointer text-primary">Why and what to say</summary>
        <p className="mt-1 font-medium text-foreground">{BAND_LABEL[s.band]}</p>
        {s.reasons.length > 0 && <ul className="mt-1 list-disc space-y-0.5 pl-4">{s.reasons.map((r) => <li key={r.id}>{r.text} (+{r.points})</li>)}</ul>}
        {s.missing.length > 0 && <p className="mt-1">Not known yet: {s.missing.join("; ")}. The score can rise once these are checked.</p>}
        <p className="mt-2 font-medium text-foreground">Note for the call</p>
        <pre className="mt-0.5 whitespace-pre-wrap font-sans">{s.pitch}</pre>
      </details>
    </div>
  );
}

type Social = { facebookUrl: string | null; source: string; status: string; pageName: string | null; followers: number | null; likes: number | null; lastPostAt: Date | null; note: string | null; fetchedAt: Date | null };
const num = (n: number) => n.toLocaleString("en-US");
const daysAgo = (d: Date) => { const n = Math.floor((Date.now() - d.getTime()) / 86_400_000); return n <= 0 ? "today" : n === 1 ? "yesterday" : `${n} days ago`; };

// Followers, likes and the last post date of the business's Facebook page, with a small form to add or correct the link
const OUTCOME_OPTION: Record<string, string> = { CONTACTED: "Contacted, still working on it", INTERESTED: "Interested, make it a lead", NOT_INTERESTED: "Not interested, close it" };
type OutreachProspect = { id: string; name: string; status: string; assignedToId: string | null; origin: string; addedById: string | null };
type LastOutreach = { outcome: string; channel?: string | null; result?: string | null; note: string | null; createdAt: Date } | null;
function LastContact({ last, author }: { last: LastOutreach; author?: string }) {
  return last ? <p className="text-[11px] text-muted"><span className="font-medium text-text">{OUTCOME_LABEL[last.outcome] ?? last.outcome}</span>{last.channel ? ` · ${CHANNEL_LABEL[last.channel] ?? last.channel}` : ""}{last.result ? ` · ${RESULT_LABEL[last.result] ?? last.result}` : ""} {last.createdAt.toISOString().slice(0, 10)}{author ? ` · ${author}` : ""}{last.note ? `: ${last.note.slice(0, 120)}` : ""}</p> : <p className="text-xs text-muted">Not contacted</p>;
}
// Log contact, Delete (a hand-added prospect nobody has contacted yet) and, for a manager, Restore of a dismissed one
function RowActions({ p, last, who, manager, back, stacked = false }: { back: string; p: OutreachProspect; last: LastOutreach; who: string; manager: boolean; stacked?: boolean }) {
  const open = !["SENT_TO_CRM", "DISMISSED", "NOT_INTERESTED"].includes(p.status);
  const mine = manager || p.assignedToId === who;
  const claimable = !p.assignedToId && ["NEW", "REVIEWED"].includes(p.status);
  const canDelete = p.origin === "MANUAL" && !last && ["NEW", "REVIEWED", "ASSIGNED"].includes(p.status) && (manager || p.addedById === who);
  // stacked = phone layout: full-width controls, the Log contact form opens across the whole row, Delete sits beside or under it
  const field = stacked ? "input" : "input !py-1 text-xs";
  return (
    <div className={stacked ? "flex flex-wrap items-center gap-x-4 gap-y-3" : "w-56 max-w-[15rem] space-y-1"}>
      {claimable && (
        <form action={claimProspectAction} aria-label={`Claim ${p.name}`}>
          <input type="hidden" name="prospectId" value={p.id} />
          <input type="hidden" name="back" value={back} />
          <SubmitButton pendingText="Claiming…">Claim this prospect</SubmitButton>
        </form>
      )}
      {open && mine && (
        <details className={stacked ? "open:w-full" : "text-xs"}>
          <summary className={stacked ? "btn-ghost inline-flex cursor-pointer list-none !py-2 text-sm [&::-webkit-details-marker]:hidden" : "cursor-pointer text-xs text-primary"}>Log contact</summary>
          <form action={logProspectContact} className={stacked ? "mt-3 space-y-3" : "mt-1 space-y-1"} aria-label={`Log contact with ${p.name}`}>
            <input type="hidden" name="prospectId" value={p.id} />
            <input type="hidden" name="back" value={back} />
            <select name="channel" className={`${field} w-full`} defaultValue="CALL" aria-label={`How you reached ${p.name}`}>
              {CHANNELS.map((c) => <option key={c} value={c}>{CHANNEL_LABEL[c]}</option>)}
            </select>
            <select name="result" className={`${field} w-full`} defaultValue="SPOKE" aria-label={`Did you speak to ${p.name}`}>
              {RESULTS.map((r) => <option key={r} value={r}>{RESULT_LABEL[r]}</option>)}
            </select>
            <select name="outcome" className={`${field} w-full`} defaultValue="CONTACTED" aria-label={`What happened with ${p.name}`}>
              {OUTCOMES.map((o) => <option key={o} value={o}>{OUTCOME_OPTION[o]}</option>)}
            </select>
            <textarea name="note" maxLength={1000} rows={stacked ? 3 : 2} placeholder="What they said" className={`${field} w-full`} aria-label={`Note about ${p.name}`} />
            <SubmitButton pendingText="Saving…">Save</SubmitButton>
          </form>
        </details>
      )}
      {canDelete && (
        <form action={removeOwnProspectAction} aria-label={`Delete ${p.name}`}>
          <input type="hidden" name="prospectId" value={p.id} />
          <input type="hidden" name="back" value={back} />
          <ConfirmButton className={stacked ? "py-2 text-sm text-brand hover:underline" : "text-xs text-brand hover:underline"} title="Delete this prospect?" message={<>{p.name} will be taken off the list. Use this for a wrong number or a duplicate. A sales manager can restore it.</>} confirmLabel="Delete">Delete</ConfirmButton>
        </form>
      )}
      {manager && p.status === "DISMISSED" && (
        <form action={reviewProspects} aria-label={`Restore ${p.name}`}>
          <input type="hidden" name="ids" value={p.id} />
          <input type="hidden" name="op" value="restore" />
          <input type="hidden" name="back" value={back} />
          <SubmitButton pendingText="Restoring…">Restore</SubmitButton>
        </form>
      )}
    </div>
  );
}
function OutreachCell({ p, last, who, manager, author, back }: { back: string; p: OutreachProspect; last: LastOutreach; who: string; manager: boolean; author?: string }) {
  return <div className="w-56 max-w-[15rem] space-y-1"><LastContact last={last} author={author} /><RowActions p={p} last={last} who={who} manager={manager} back={back} /></div>;
}

function SocialCell({ s, prospectId, name, canEdit }: { s: Social | null; prospectId: string; name: string; canEdit: boolean }) {
  const form = canEdit && (
    <details className="text-xs">
      <summary className="cursor-pointer text-primary">{s?.facebookUrl ? "Change link" : "Add link"}</summary>
      <form action={saveFacebookLink} className="mt-1 flex max-w-[16rem] items-center gap-1" aria-label={`Facebook link for ${name}`}>
        <input type="hidden" name="prospectId" value={prospectId} />
        <input name="facebookUrl" defaultValue={s?.facebookUrl ?? ""} maxLength={300} placeholder="facebook.com/theirpage" className="input !py-1 text-xs" aria-label={`Facebook page address for ${name}`} />
        <SubmitButton pendingText="Saving…">Save</SubmitButton>
      </form>
    </details>
  );
  if (!s?.facebookUrl) return <div className="space-y-1"><p className="text-xs text-muted">No Facebook link found</p>{form}</div>;
  return (
    <div className="max-w-[16rem] space-y-1">
      <a className="break-all text-xs text-primary hover:underline" href={s.facebookUrl} target="_blank" rel="noopener noreferrer">{s.facebookUrl.replace(/^https:\/\/www\./, "").slice(0, 40)}</a>
      <p className="text-[11px] text-muted">{s.source === "MANUAL" ? "Added by a person" : "Found on their website"}</p>
      {s.followers != null || s.lastPostAt || s.likes != null ? (
        <div className="flex flex-wrap gap-1">
          {s.followers != null && <Badge tone="primary">{num(s.followers)} followers</Badge>}
          {s.likes != null && <Badge tone="neutral">{num(s.likes)} likes</Badge>}
          {s.lastPostAt && <Badge tone={Date.now() - s.lastPostAt.getTime() > 90 * 86_400_000 ? "warning" : "success"}>Last post {daysAgo(s.lastPostAt)}</Badge>}
        </div>
      ) : s.status === "NOT_FETCHED" ? <p className="text-xs text-muted">Numbers not fetched yet</p> : null}
      {s.status === "OK" && s.lastPostAt == null && <p className="text-xs text-muted">Last post date not available.</p>}
      {s.status !== "OK" && s.status !== "NOT_FETCHED" && s.note && <p className="text-xs text-muted">{s.note}</p>}
      {form}
    </div>
  );
}

type Check = { status: string; reachable: boolean | null; httpStatus: number | null; https: boolean | null; hasTitle: boolean | null; hasMetaDescription: boolean | null; hasAnalytics: boolean | null; hasGtm: boolean | null; hasMetaPixel: boolean | null; hasContactForm: boolean | null; hasWhatsapp: boolean | null; lowConfidence: boolean | null; psiStatus: string | null; psiNote: string | null; mobileScore: number | null; seoScore: number | null; fcpMs: number | null; lcpMs: number | null; tbtMs: number | null; cls: unknown; speedIndexMs: number | null; error: string | null; checkedAt: Date | null };
const scoreTone = (n: number) => (n >= 90 ? "success" : n >= 50 ? "warning" : "danger") as "success" | "warning" | "danger";
const secs = (ms: number | null) => (ms == null ? "n/a" : `${(ms / 1000).toFixed(1)} s`);

// What the website check found, as a short list of gaps the sales team can pitch. Nothing here is guessed: a gap is shown only when the page was read.
function CheckCell({ c, hasWebsite }: { c: Check | null; hasWebsite: boolean }) {
  if (!hasWebsite) return <Badge tone="danger">No website</Badge>;
  if (!c) return <span className="text-muted">Not checked</span>;
  if (c.status === "QUEUED") return <Badge tone="neutral">Waiting</Badge>;
  if (c.status === "RUNNING") return <Badge tone="primary">Checking…</Badge>;
  if (c.status === "NO_WEBSITE") return <Badge tone="danger">No website</Badge>;
  if (c.status === "FAILED") return <span className="text-xs text-brand">{c.error ?? "The check failed."}</span>;
  if (c.reachable === false) return <div className="space-y-1"><Badge tone="danger">Site not reachable</Badge><p className="max-w-[16rem] text-xs text-muted">{c.error}</p></div>;
  if (c.reachable === null) return <p className="max-w-[16rem] text-xs text-muted">{c.error}</p>;
  const gaps: string[] = [];
  if (c.https === false) gaps.push("No HTTPS");
  if (c.hasTitle === false) gaps.push("No page title");
  if (c.hasMetaDescription === false) gaps.push("No meta description");
  if (c.hasAnalytics === false) gaps.push("No analytics");
  if (c.hasMetaPixel === false) gaps.push(c.hasGtm ? "No Meta Pixel seen (may be in Tag Manager)" : "No Meta Pixel");
  if (c.hasContactForm === false) gaps.push("No contact form");
  if (c.hasWhatsapp === false) gaps.push("No WhatsApp link");
  return (
    <div className="max-w-[18rem] space-y-1.5">
      <div className="flex flex-wrap gap-1">
        {c.mobileScore != null && <Badge tone={scoreTone(c.mobileScore)}>Mobile {c.mobileScore}</Badge>}
        {c.seoScore != null && <Badge tone={scoreTone(c.seoScore)}>SEO {c.seoScore}</Badge>}
        {gaps.map((g) => <Badge key={g} tone="warning">{g}</Badge>)}
        {gaps.length === 0 && c.mobileScore == null && <Badge tone="success">No gaps found</Badge>}
      </div>
      {c.psiStatus && c.psiStatus !== "OK" && <p className="text-xs text-muted">{c.psiNote}</p>}
      {c.lowConfidence && <p className="text-xs text-muted">This page builds itself in the browser, so some gaps above may be wrong.</p>}
      {c.psiStatus === "OK" && <details className="text-xs text-muted"><summary className="cursor-pointer">Speed details</summary>
        <p>First paint {secs(c.fcpMs)}, largest content {secs(c.lcpMs)}, blocking time {c.tbtMs ?? "n/a"} ms, layout shift {c.cls == null ? "n/a" : String(c.cls)}, speed index {secs(c.speedIndexMs)}.</p></details>}
    </div>
  );
}

function Meter({ label, value, max, text }: { label: string; value: number; max: number; text: string }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 100;
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs"><span className="font-medium">{label}</span><span className="text-muted">{text}</span></div>
      <div className="h-2 overflow-hidden rounded-full bg-hover" role="progressbar" aria-label={label} aria-valuenow={Math.round(value * 100) / 100} aria-valuemin={0} aria-valuemax={max}>
        <div className={`h-full rounded-full ${pct >= 90 ? "bg-brand" : pct >= 70 ? "bg-warning" : "bg-primary"}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default async function ProspectorView({ searchParams, base: BASE, mine: mineView = false }: { searchParams: Promise<Record<string, string | undefined>>; base: string; mine?: boolean }) {
  const user = await requirePermission("crm.view");
  const sp = await searchParams;
  const lp = parseListParams(sp, { sorts: Object.keys(PROSPECT_SORTS), statuses: PROSPECT_STATUSES, ids: ["search", "added"] });
  const manager = isManager(user);
  // My Prospects is only the person's own list and the add form: no usage meters, no Google search, no bulk or limit tools (those stay on Prospector)
  const searcher = !mineView && canSearch(user);
  const tools = !mineView && (manager || user.permissions.has("prospector.manage"));
  const org = user.organizationId;
  const configured = await isConfigured(db, org, "GOOGLE_PLACES");
  const caps = googleCaps();

  const manualOnly = lp.ids.added === "1";
  // My Prospects keeps deleted (dismissed) ones out of sight: a person never sees them again, a manager sees them only under the Dismissed filter, where they can be restored
  const hideDismissed = mineView && (!manager || !lp.status);
  const statusFilter = mineView && !manager && lp.status === "DISMISSED" ? undefined : lp.status;
  const dateBy = sp.by === "contact" ? "contact" : "added";
  const hasRange = Boolean(lp.range.from || lp.range.to);
  const where = prospectWhere(user, { q: lp.q, status: statusFilter, searchId: lp.ids.search, manual: manualOnly, mineOnly: mineView, hideDismissed, range: lp.range, dateBy });
  const scope = prospectWhere(user, { manual: manualOnly, mineOnly: mineView, range: lp.range, dateBy }); // the chip numbers count what the list can show, not every prospect the person may see
  const [rows, matched, counts, agents, meter, mine, limit, psiMeter, fbMeter] = await Promise.all([
    db.prospect.findMany({ where, orderBy: orderFor(lp.sort, PROSPECT_SORTS), skip: lp.page.skip, take: lp.page.take }),
    db.prospect.count({ where }),
    db.prospect.groupBy({ by: ["status"], where: scope, _count: true }),
    manager ? assignableAgents(db, org) : Promise.resolve([]),
    tools ? usage(db, org, "GOOGLE_PLACES", caps) : Promise.resolve(null),
    searcher ? searchesToday(db, org, user.id) : Promise.resolve(0),
    searcher ? dailyLimitFor(db, org, user.id) : Promise.resolve(0),
    tools ? pageSpeedUsage(db, org) : Promise.resolve(null),
    tools ? socialUsage(db, org) : Promise.resolve(null),
  ]);
  const socials = new Map((await db.prospectSocial.findMany({ where: { prospectId: { in: rows.map((r) => r.id) } } })).map((x) => [x.prospectId, x as Social]));
  const checks = new Map((await db.prospectWebsiteCheck.findMany({ where: { prospectId: { in: rows.map((r) => r.id) } } })).map((c) => [c.prospectId, c as Check]));
  const scores = new Map(rows.map((r) => [r.id, scoreProspect(inputFor({ name: r.name, origin: r.origin, website: r.website, rating: r.rating, ratingCount: r.ratingCount, websiteCheck: checks.get(r.id) ?? null, social: socials.get(r.id) ?? null }))]));
  const outreachRows = await db.prospectOutreach.findMany({ where: { prospectId: { in: rows.map((r) => r.id) } }, orderBy: { createdAt: "desc" } });
  const lastOutreach = new Map<string, (typeof outreachRows)[number]>();
  for (const o of outreachRows) if (!lastOutreach.has(o.prospectId)) lastOutreach.set(o.prospectId, o);
  const outreachNames = new Map((await db.user.findMany({ where: { id: { in: [...new Set(outreachRows.map((o) => o.userId))] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const pending = [...checks.values()].some((c) => c.status === "QUEUED" || c.status === "RUNNING");
  const canAdd = user.permissions.has("crm.edit");
  const defaultCountry = canAdd ? (await getPolicy(db, org)).defaultCountry : "PK";
  const campaignOptions = canAdd ? await db.campaign.findMany({ where: { organizationId: org, archivedAt: null, status: { in: ["ACTIVE", "PLANNED"] } }, orderBy: { name: "asc" }, select: { id: true, name: true } }) : [];
  const manualCount = await db.prospect.count({ where: prospectWhere(user, { manual: true, mineOnly: mineView, hideDismissed: mineView }) });
  const canTick = !mineView && (manager || searcher);
  const byStatus = new Map(counts.map((c) => [c.status, c._count]));
  const total = counts.reduce((a, c) => a + (mineView && c.status === "DISMISSED" ? 0 : c._count), 0);
  const names = new Map((await db.user.findMany({ where: { id: { in: rows.map((r) => r.assignedToId).filter(Boolean) as string[] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));

  const manageLimits = !mineView && user.permissions.has("prospector.manage");
  const searchers = manageLimits ? await db.user.findMany({ where: { id: { in: await usersWithPermission(db, org, "prospector.use") } }, select: { id: true, name: true }, orderBy: { name: "asc" } }) : [];
  const overrides = manageLimits ? await db.prospectorUserLimit.findMany({ where: { organizationId: org } }) : [];
  const defaultLimit = manageLimits ? await dailyLimitFor(db, org, "none") : 0;

  const cur = { q: lp.q, status: lp.status, search: lp.ids.search, added: lp.ids.added, sort: lp.sortChosen ? lp.sort.key : undefined, dir: lp.sortChosen ? lp.sort.dir : undefined, from: lp.range.from, to: lp.range.to, by: dateBy === "contact" ? "contact" : undefined };
  const href = (over: Record<string, string | undefined>) => listHref(BASE, cur, over);
  const countries = countryOptions();
  const e20 = estimate(20).costUsd;

  return (
    <div className="space-y-6">
      <PageHeader title={mineView ? "My Prospects" : "Prospector"} subtitle={mineView ? "Prospects assigned to you or added by you. Press Add prospect for someone you found yourself, and Log contact on a row after you speak to them." : "Find businesses by type and city, assign them to the sales team, and record each contact. A business found here is a prospect, not a lead: it becomes a lead only when it says it is interested."} />
      {sp.error && <Notice kind="error">{sp.error}</Notice>}
      {sp.ok && <Notice kind="ok">{sp.ok}</Notice>}

      {(meter || searcher) && (
        <section className="card space-y-3" aria-label="Usage">
          <h2 className="font-semibold">Usage</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {meter && <Meter label="Google budget this month" value={meter.monthSpentUsd} max={meter.monthlyCapUsd} text={`${usd(meter.monthSpentUsd)} of ${usd(meter.monthlyCapUsd)}`} />}
            {meter && <Meter label="Google requests today" value={meter.dayCalls} max={meter.dailyCap} text={`${meter.dayCalls} of ${meter.dailyCap}`} />}
            {fbMeter && fbMeter.monthlyCalls != null && <Meter label="Facebook requests this month" value={fbMeter.monthCalls} max={fbMeter.monthlyCalls} text={`${fbMeter.monthCalls} of ${fbMeter.monthlyCalls}`} />}
            {psiMeter && <Meter label="PageSpeed checks today" value={psiMeter.dayCalls} max={psiMeter.dailyCap} text={`${psiMeter.dayCalls} of ${psiMeter.dailyCap}`} />}
            {searcher && <Meter label="Your searches today" value={mine} max={limit} text={`${mine} of ${limit}`} />}
          </div>
          {meter && <p className="text-xs text-muted">Counted at Google&apos;s list price, before its free monthly allowance, so the real bill is usually lower. The caps are set on the server and cannot be passed.</p>}
        </section>
      )}

      {searcher && (configured ? (
        <form action={searchProspects} className="card grid gap-3 sm:grid-cols-2 lg:grid-cols-5" aria-label="Search for businesses">
          <h2 className="font-semibold sm:col-span-2 lg:col-span-5">Find businesses</h2>
          <div className="lg:col-span-2"><label className="label" htmlFor="businessType">Type of business</label><input id="businessType" name="businessType" required minLength={2} maxLength={80} placeholder="Dentist, restaurant, real estate agent…" className="input" /></div>
          <div><label className="label" htmlFor="city">City</label><input id="city" name="city" required minLength={2} maxLength={80} placeholder="Lahore" className="input" /></div>
          <div><label className="label" htmlFor="country">Country</label>
            <select id="country" name="country" defaultValue="PK" className="input">{countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</select></div>
          <div><label className="label" htmlFor="maxResults">How many</label>
            <select id="maxResults" name="maxResults" defaultValue="20" className="input">{RESULT_CHOICES.map((n) => <option key={n} value={n}>Up to {n} (~${estimate(n).costUsd.toFixed(3)})</option>)}</select></div>
          <div className="flex flex-wrap items-center gap-3 sm:col-span-2 lg:col-span-5">
            <SubmitButton pendingText="Searching…">Search</SubmitButton>
            <p className="text-xs text-muted">Each batch of 20 results costs about ${e20.toFixed(3)} of the Google budget. Businesses already known to us are not added twice.</p>
          </div>
        </form>
      ) : (
        <Notice kind="error">Google Places is not configured, so searching is switched off. A Super Admin can add the Google Places key in Administration, then Integrations.</Notice>
      ))}

      {canAdd && (
        <div className="flex flex-wrap items-start gap-2">
          <AddProspect campaigns={campaignOptions} countries={callingCodeOptions().map((c) => ({ code: c.code, label: c.label }))} defaultCountry={defaultCountry} />
          {manager && !mineView && <ImportProspects countries={callingCodeOptions().map((c) => ({ code: c.code, label: c.label }))} defaultCountry={defaultCountry} agents={agents.map((a) => ({ id: a.id, label: a.name }))} />}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Chips current={lp.status ?? "ALL"} items={[{ key: "ALL", label: "All", count: total, href: href({ status: undefined, page: undefined }) }, ...PROSPECT_STATUSES.filter((st) => !(mineView && !manager && st === "DISMISSED")).map((st) => ({ key: st, label: LABEL[st], count: byStatus.get(st) ?? 0, href: href({ status: st, page: undefined }) }))]} />
        <Link className={manualOnly ? "btn" : "btn-ghost"} href={href({ added: manualOnly ? undefined : "1", page: undefined })} aria-pressed={manualOnly}>Added or imported{manualCount > 0 ? ` (${manualCount})` : ""}</Link>
        <SearchBox q={lp.q} placeholder="Search name, address, phone, website" hidden={{ status: lp.status, search: lp.ids.search, added: lp.ids.added, from: lp.range.from, to: lp.range.to, by: cur.by }} />
      </div>

      <DateFilterBar base={BASE} current={{ q: lp.q, status: lp.status, search: lp.ids.search, added: lp.ids.added, sort: cur.sort, dir: cur.dir }} range={lp.range} by={dateBy === "contact" ? "contact" : undefined} byOptions={[{ value: "added", label: "Date added" }, { value: "contact", label: "Last contacted" }]} />

      {canTick && <form id="bulk" action={reviewProspects} className="card flex flex-wrap items-end gap-3" aria-label="Actions for ticked prospects">
        {manager && <>
          <div><label className="label" htmlFor="agentId">Assign ticked to</label>
            <select id="agentId" name="agentId" className="input" defaultValue=""><option value="" disabled>Choose a person</option>{agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
          <button className="btn" name="op" value="assign">Assign</button>
          <button className="btn-ghost" name="op" value="review">Mark reviewed</button>
          <button className="btn-ghost" name="op" value="dismiss">Dismiss</button>
          <button className="btn-ghost" name="op" value="restore">Restore</button>
        </>}
        <button className="btn-ghost" formAction={checkWebsites} title="Reads each ticked business's website and asks Google PageSpeed for its scores">Check websites</button>
        <button className="btn-ghost" formAction={checkWebsites} name="force" value="1" title="Repeat the check even if it was done in the last week">Check again</button>
        <button className="btn-ghost" formAction={getFacebookData} title="Reads followers, likes and the last post date from each ticked business's Facebook page. Each business uses 2 of the monthly SocialAPIs requests; up to 5 at a time.">Get Facebook data</button>
        <button className="btn-ghost" formAction={getFacebookData} name="force" value="1" title="Repeat even if it was fetched in the last week">Fetch again</button>
        {manager && <button className="btn-ghost" formAction={updateScores} title="Scores every prospect again from what is known now">Update scores</button>}
        {pending && <AutoRefresh />}
      </form>}

      <div className="card !p-0 overflow-x-auto">
        {rows.length === 0 ? (
          <div className="p-6"><Empty title={total === 0 && !hasRange ? "No prospects yet" : "No prospects match"}>{total === 0 && !hasRange ? (mineView ? "Prospects assigned to you or added by you will appear here. Press Add prospect to add one you found yourself." : searcher ? "Use the search above to find businesses." : manager ? "Ask for search access, or wait for a colleague to run a search." : "Prospects assigned to you will appear here.") : "Try another status, search or date range."}</Empty></div>
        ) : (
          <>
          {mineView ? (
            <>
              <ul className="divide-y divide-border md:hidden" aria-label="My prospects">
                {rows.map((r) => {
                  const last = lastOutreach.get(r.id) ?? null;
                  return (
                    <li key={r.id} className="space-y-2 px-4 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <p className="min-w-0 break-words font-medium">{r.name}</p>
                        <Badge tone={TONE[r.status] ?? "neutral"}>{LABEL[r.status] ?? r.status}</Badge>
                      </div>
                      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                        {r.phone ? <a className="whitespace-nowrap text-primary hover:underline" href={`tel:${r.phone}`}>{r.phone}</a> : <span className="text-muted">No phone</span>}
                        {r.origin === "MANUAL" && <Badge tone="neutral">{(MANUAL_SOURCE_LABEL[r.sourceLabel ?? ""] ?? r.sourceLabel ?? "Added by hand")}</Badge>}
                      </p>
                      {r.email && <p className="break-all text-xs"><a className="text-primary hover:underline" href={`mailto:${r.email}`}>{r.email}</a></p>}
                      {r.notes && <p className="text-xs text-muted">{r.notes.slice(0, 160)}</p>}
                      <LastContact last={last} author={outreachNames.get(last?.userId ?? "")} />
                      {r.leadId && <p className="text-xs"><Link className="text-primary hover:underline" href={`/leads/${r.leadId}`}>Open the lead</Link></p>}
                      <RowActions stacked p={r} last={last} who={user.id} manager={manager} back={BASE} />
                    </li>
                  );
                })}
              </ul>
              <table className="hidden w-full text-sm md:table">
                <thead className="bg-hover/60 text-left text-xs text-muted"><tr>
                  <th className="py-2 pl-4 pr-3">Prospect</th><th className="pr-3">Phone</th><th className="pr-3">Status</th><th className="pr-3">Last contact</th><th className="pr-4">Action</th>
                </tr></thead>
                <tbody>
                  {rows.map((r) => {
                    const last = lastOutreach.get(r.id) ?? null;
                    return (
                      <tr key={r.id} className="border-t border-border align-top transition hover:bg-hover/50">
                        <td className="py-2 pl-4 pr-3"><p className="font-medium">{r.name}</p>{r.origin === "MANUAL" && <p className="mt-0.5"><Badge tone="neutral">{(MANUAL_SOURCE_LABEL[r.sourceLabel ?? ""] ?? r.sourceLabel ?? "Added by hand")}</Badge></p>}{r.notes && <p className="mt-0.5 max-w-xs text-xs text-muted">{r.notes.slice(0, 120)}</p>}</td>
                        <td className="py-2 pr-3">{r.phone ? <a className="whitespace-nowrap text-primary hover:underline" href={`tel:${r.phone}`}>{r.phone}</a> : <span className="text-muted">No phone</span>}{r.email && <p className="break-all text-xs"><a className="text-primary hover:underline" href={`mailto:${r.email}`}>{r.email}</a></p>}</td>
                        <td className="py-2 pr-3"><Badge tone={TONE[r.status] ?? "neutral"}>{LABEL[r.status] ?? r.status}</Badge>{r.leadId && <p className="mt-1 text-xs"><Link className="text-primary hover:underline" href={`/leads/${r.leadId}`}>Open the lead</Link></p>}</td>
                        <td className="py-2 pr-3"><LastContact last={last} author={outreachNames.get(last?.userId ?? "")} /></td>
                        <td className="py-2 pr-4"><RowActions p={r} last={last} who={user.id} manager={manager} back={BASE} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          ) : (
          <table className="w-full text-sm">
            <thead className="bg-hover/60 text-left text-xs text-muted"><tr>
              {canTick && <th className="w-8 py-2 pl-4"><span className="sr-only">Select</span></th>}
              <th className="py-2 pl-4 pr-4">Business</th><th className="pr-4">Phone</th><th className="pr-4">Website</th><th className="pr-4"><Link className="hover:underline" href={href({ sort: "score", dir: "desc", page: undefined })} title="Best opportunity first">Opportunity</Link></th><th className="pr-4">Website check</th><th className="pr-4">Facebook</th><th className="pr-4">Rating</th><th className="pr-4">Contact</th><th className="pr-4">Status</th><th className="pr-4">Assigned to</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-border align-top transition hover:bg-hover/50">
                  {canTick && <td className="py-2 pl-4">{r.status !== "SENT_TO_CRM" && <input type="checkbox" form="bulk" name="ids" value={r.id} aria-label={`Select ${r.name}`} />}</td>}
                  <td className="py-2 pl-4 pr-4"><p className="font-medium">{r.name}</p>{r.origin === "MANUAL" && <p className="text-xs text-muted">{r.contactName ? `${r.contactName} · ` : ""}<Badge tone="neutral">{(MANUAL_SOURCE_LABEL[r.sourceLabel ?? ""] ?? r.sourceLabel ?? "Added by hand")}</Badge>{r.sourceDetail ? ` ${r.sourceDetail}` : ""}</p>}{r.notes && <p className="max-w-xs text-xs text-muted">{r.notes.slice(0, 160)}</p>}<p className="max-w-xs text-xs text-muted">{r.address}</p>{r.mapsUrl && <a className="text-xs text-primary hover:underline" href={r.mapsUrl} target="_blank" rel="noopener noreferrer">Open in Google Maps</a>}</td>
                  <td className="pr-4 whitespace-nowrap">{r.phone ? <a className="hover:underline" href={`tel:${r.phone}`}>{r.phone}</a> : <span className="text-muted">None listed</span>}{r.email && <p className="text-xs"><a className="hover:underline" href={`mailto:${r.email}`}>{r.email}</a></p>}</td>
                  <td className="pr-4">{r.website ? <a className="break-all text-primary hover:underline" href={r.website} target="_blank" rel="noopener noreferrer">{r.website.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "").slice(0, 32)}</a> : <span className="text-muted">No website</span>}</td>
                  <td className="pr-4"><ScoreCell s={scores.get(r.id)!} /></td>
                  <td className="pr-4">{r.origin === "MANUAL" && !r.website ? <span className="text-xs text-muted">Not known</span> : <CheckCell c={checks.get(r.id) ?? null} hasWebsite={Boolean(r.website)} />}</td>
                  <td className="pr-4"><SocialCell s={socials.get(r.id) ?? null} prospectId={r.id} name={r.name} canEdit={canTick} /></td>
                  <td className="pr-4 whitespace-nowrap">{r.rating ? `${r.rating} (${r.ratingCount ?? 0})` : <span className="text-muted">No reviews</span>}</td>
                  <td className="pr-4"><OutreachCell p={r} last={lastOutreach.get(r.id) ?? null} who={user.id} manager={manager} author={outreachNames.get(lastOutreach.get(r.id)?.userId ?? "")} back={BASE} /></td>
                  <td className="pr-4"><Badge tone={TONE[r.status] ?? "neutral"}>{LABEL[r.status] ?? r.status}</Badge>{r.leadId && <p className="mt-1 text-xs"><Link className="text-primary hover:underline" href={`/leads/${r.leadId}`}>Open the lead</Link></p>}</td>
                  <td className="pr-4">{r.assignedToId ? names.get(r.assignedToId) ?? "Unknown" : <span className="text-muted">Nobody</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          )}
          </>
        )}
        <Pager page={lp.page.page} size={lp.page.size} total={matched} href={(n) => href({ page: n > 1 ? String(n) : undefined })} />
      </div>
      {!mineView && <p className="text-xs text-muted">Business details come from Google Maps. Phone numbers are shown in international format. Website checks read the home page the way a visitor&apos;s browser would, so anything a site adds only with scripts or a tag manager may be missed. {lp.ids.search && <Link className="text-primary hover:underline" href={href({ search: undefined, page: undefined })}>Show all searches</Link>}</p>}

      {manageLimits && (
        <form action={saveSearchLimits} className="card space-y-3" aria-label="Search limits">
          <div><h2 className="font-semibold">Who can search, and how often</h2><p className="text-xs text-muted">Give a colleague search access in Roles (permission Prospector: run searches). Leave a person&apos;s box empty to use the default.</p></div>
          <div className="max-w-xs"><label className="label" htmlFor="defaultLimit">Default searches per person per day</label><input id="defaultLimit" name="defaultLimit" type="number" min={0} max={500} defaultValue={defaultLimit} className="input" /></div>
          {searchers.length > 0 && <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {searchers.map((p) => <div key={p.id}><label className="label" htmlFor={`l-${p.id}`}>{p.name}</label><input id={`l-${p.id}`} name={`limit:${p.id}`} type="number" min={0} max={500} defaultValue={overrides.find((o) => o.userId === p.id)?.dailySearches ?? ""} placeholder={`Default (${defaultLimit})`} className="input" /></div>)}
          </div>}
          <SubmitButton>Save limits</SubmitButton>
        </form>
      )}
    </div>
  );
}
