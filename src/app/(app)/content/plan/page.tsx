import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { PLATFORMS, PLATFORM_META } from "@/lib/content-rules";
import { PLAN_TYPES, aiSpend, isMonth, monthNeeds } from "@/lib/content-ai";
import { isConfigured } from "@/lib/integration-keys";
import { Notice, PageHeader, SubmitButton } from "@/components/ui";
import ConfirmButton from "@/components/ui/ConfirmButton";
import { PlatformDot } from "../PostForm";
import { deleteHashtagGroupAction, generatePlanAction, saveHashtagGroupAction, saveProfileAction, undoPlanAction } from "./actions";

export const dynamic = "force-dynamic";

type SP = { client?: string; m?: string; ok?: string; error?: string };
const nextMonth = () => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString().slice(0, 7); };

export default async function PlanTheMonth({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePermission("content.manage");
  const sp = await searchParams;
  const org = user.organizationId;
  const month = isMonth(sp.m ?? "") ? sp.m! : nextMonth();
  const clients = await db.client.findMany({ where: { organizationId: org, active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } });
  const client = clients.find((c) => c.id === sp.client);
  const [profile, needs, claudeOn, imagesOn, runs] = client ? await Promise.all([
    db.clientContentProfile.findUnique({ where: { clientId: client.id } }),
    monthNeeds(db, { organizationId: org, clientId: client.id, month }),
    isConfigured(db, org, "ANTHROPIC"),
    isConfigured(db, org, "GEMINI"),
    db.contentAiRun.findMany({ where: { organizationId: org, clientId: client.id, kind: "PLAN", undoneAt: null, postCount: { gt: 0 } }, orderBy: { createdAt: "desc" }, take: 5 }),
  ]) : [null, null, false, false, []];
  const groups = client ? await db.hashtagGroup.findMany({ where: { organizationId: org, clientId: client.id }, orderBy: { name: "asc" } }) : [];
  const todayMonth = new Date().toISOString().slice(0, 7);
  const spent = client ? await aiSpend(db, client.id, todayMonth) : 0;
  const cap = profile ? Number(profile.monthlyCapUsd) : 10;
  const profileReady = Boolean(profile && (profile.about ?? "").trim().length >= 20);
  const monthLabel = new Date(month + "-01T00:00:00Z").toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

  return (
    <div className="max-w-3xl space-y-5">
      <PageHeader back={{ href: "/content", label: "Content calendar" }} title="Plan the month"
        subtitle="Choose a client and month. AI writes every post the client's plan includes as drafts: title, caption, hashtags, type, platforms, date and a brief for the maker. Nothing goes to the client until you send it on." />
      {sp.ok && <Notice kind="ok">{sp.ok}</Notice>}
      {sp.error && <Notice kind="error">{sp.error}</Notice>}

      <form method="get" className="card flex flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1"><label className="label" htmlFor="pl-client">Client</label>
          <select id="pl-client" name="client" defaultValue={sp.client ?? ""} className="input"><option value="">Choose a client</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <div><label className="label" htmlFor="pl-month">Month</label><input id="pl-month" name="m" type="month" defaultValue={month} className="input" /></div>
        <button className="btn-ghost">Open</button>
      </form>

      {client && needs && (
        <>
          <section className="card space-y-3" aria-label="Content profile">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold">1. Content profile: {client.name}</h2>
              <span className={`rounded-full border px-2 py-0.5 text-xs ${profileReady ? "border-success/30 text-success" : "border-border text-muted"}`}>{profileReady ? "Ready" : "Needs details"}</span>
            </div>
            <p className="text-sm text-muted">What the AI knows about this client. The more specific, the better the posts. Saved once and reused every month.</p>
            <form action={saveProfileAction} className="grid gap-3">
              <input type="hidden" name="clientId" value={client.id} /><input type="hidden" name="month" value={month} />
              <div><label className="label" htmlFor="p-about">About the business <span className="text-brand">*</span></label><textarea id="p-about" name="about" rows={4} defaultValue={profile?.about ?? ""} maxLength={4000} placeholder="What it sells, who it serves, current offers, the solution being promoted and its main benefits" className="input" /></div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div><label className="label" htmlFor="p-voice">Brand voice</label><input id="p-voice" name="brandVoice" defaultValue={profile?.brandVoice ?? ""} maxLength={1000} placeholder="Warm, professional, short sentences" className="input" /></div>
                <div><label className="label" htmlFor="p-aud">Audience</label><input id="p-aud" name="audience" defaultValue={profile?.audience ?? ""} maxLength={1000} placeholder="Homeowners in Lahore, 30 to 55" className="input" /></div>
                <div><label className="label" htmlFor="p-lang">Languages</label><input id="p-lang" name="languages" defaultValue={profile?.languages ?? ""} maxLength={200} placeholder="English, Roman Urdu" className="input" /></div>
                <div><label className="label" htmlFor="p-tags">Hashtag rules</label><input id="p-tags" name="hashtagRules" defaultValue={profile?.hashtagRules ?? ""} maxLength={500} placeholder="Always include #BrandName, 6 to 8 in total" className="input" /></div>
              </div>
              <div><label className="label" htmlFor="p-topics">Topics to cover</label><textarea id="p-topics" name="topics" rows={2} defaultValue={profile?.topics ?? ""} maxLength={2000} placeholder="Tips, behind the scenes, customer stories, offers" className="input" /></div>
              <div><label className="label" htmlFor="p-avoid">Never say or show</label><textarea id="p-avoid" name="avoid" rows={2} defaultValue={profile?.avoid ?? ""} maxLength={1500} placeholder="Competitor names, price promises, political topics" className="input" /></div>
              <div><label className="label" htmlFor="p-vis">Visual style (used for AI images)</label><input id="p-vis" name="visualStyle" defaultValue={profile?.visualStyle ?? ""} maxLength={1000} placeholder="Bright, clean, navy and gold, lots of white space" className="input" /></div>
              <fieldset><legend className="label">Platforms this client posts on</legend>
                <div className="flex flex-wrap gap-2">
                  {PLATFORMS.filter((p) => p !== "OTHER").map((p) => (
                    <label key={p} className="flex cursor-pointer items-center gap-2 rounded-full border border-border bg-surface py-1 pl-1 pr-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/10">
                      <input type="checkbox" name="platforms" value={p} defaultChecked={profile?.platforms.includes(p)} className="sr-only" /><PlatformDot code={PLATFORM_META[p].code} color={PLATFORM_META[p].color} />{PLATFORM_META[p].label}
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="max-w-56"><label className="label" htmlFor="p-cap">Monthly AI limit (US dollars)</label><input id="p-cap" name="monthlyCapUsd" type="number" min="0" max="1000" step="1" defaultValue={String(cap)} className="input" /></div>
              <div><SubmitButton pendingText="Saving…">Save profile</SubmitButton></div>
            </form>
          </section>

          <section className="card space-y-3" aria-label="Plan the month">
            <h2 className="font-semibold">2. Write {monthLabel}</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted"><tr><th className="py-1 pr-4">Included each month</th><th className="pr-4">In plan</th><th className="pr-4">Already planned</th><th>Left to write</th></tr></thead>
                <tbody>{PLAN_TYPES.map((t) => <tr key={t.key} className="border-t border-border"><td className="py-1.5 pr-4">{t.label}</td><td className="pr-4">{needs.promised[t.key]}</td><td className="pr-4">{needs.planned[t.key]}</td><td className="font-medium">{needs.remaining[t.key]}</td></tr>)}</tbody>
              </table>
            </div>
            {!needs.hasQuota && <p className="text-sm text-muted">This client has no active retainer with Reels, Long videos or Static creatives, so enter the numbers by hand.</p>}
            {!claudeOn && <Notice kind="error">AI planning is not configured. A Super Admin adds the Anthropic key in <Link href="/settings/integrations" className="underline">Settings → Integrations</Link>.</Notice>}
            {!profileReady && <Notice kind="error">Fill in and save the content profile above (at least what the business does) before writing the month.</Notice>}
            <form action={generatePlanAction} className="grid gap-3">
              <input type="hidden" name="clientId" value={client.id} /><input type="hidden" name="month" value={month} />
              <div className="grid grid-cols-3 gap-3">
                {PLAN_TYPES.map((t) => <div key={t.key}><label className="label" htmlFor={`n-${t.key}`}>{t.label}</label><input id={`n-${t.key}`} name={t.key} type="number" min="0" max="40" defaultValue={needs.remaining[t.key]} className="input" /></div>)}
              </div>
              <div><label className="label" htmlFor="pl-brief">This month&apos;s brief</label><textarea id="pl-brief" name="monthBrief" rows={4} maxLength={4000} placeholder="Offers, launches, events and dates to use, for example: 20% off from the 5th to the 12th; Eid sale on the 25th" className="input" /></div>
              <p className="text-xs text-muted">Posts are spread across the month (not Sundays) and written as drafts. Estimated cost about $0.20 to $1. AI spent on this client this month: about ${spent.toFixed(2)} of ${cap.toFixed(2)}.</p>
              <div><SubmitButton pendingText="Writing the month… this can take a few minutes">Write the month with AI</SubmitButton></div>
            </form>
          </section>

          <section className="card space-y-3" aria-label="Hashtag groups">
            <h2 className="font-semibold">Hashtag groups</h2>
            <p className="text-sm text-muted">Saved sets for this client, for example the brand set or a campaign set. AI uses them when it writes the month, and the team adds them to a post in one click.</p>
            {groups.map((g) => (
              <div key={g.id} className="flex flex-wrap items-start justify-between gap-2 border-t border-border pt-2 text-sm first:border-0 first:pt-0">
                <div className="min-w-0"><p className="font-medium">{g.name}</p><p className="break-words text-muted">{g.tags}</p></div>
                <form action={deleteHashtagGroupAction}>
                  <input type="hidden" name="id" value={g.id} /><input type="hidden" name="clientId" value={client.id} /><input type="hidden" name="month" value={month} />
                  <ConfirmButton title={`Delete “${g.name}”?`} message="Posts that already use these hashtags keep them." confirmLabel="Delete group">Delete</ConfirmButton>
                </form>
              </div>
            ))}
            <form action={saveHashtagGroupAction} className="grid gap-2 sm:grid-cols-[12rem_1fr_auto] sm:items-end">
              <input type="hidden" name="clientId" value={client.id} /><input type="hidden" name="month" value={month} />
              <div><label className="label" htmlFor="hg-name">Group name</label><input id="hg-name" name="name" required minLength={2} maxLength={60} placeholder="Brand" className="input" /></div>
              <div><label className="label" htmlFor="hg-tags">Hashtags</label><input id="hg-tags" name="tags" required maxLength={1000} placeholder="#BrandName #Lahore #Shoes" className="input" /></div>
              <SubmitButton className="btn-ghost" pendingText="Saving…">Add group</SubmitButton>
            </form>
          </section>

          <section className="card space-y-2" aria-label="Recent AI plans">
            <h2 className="font-semibold">Recent AI plans</h2>
            {runs.length === 0 ? <p className="text-sm text-muted">None yet for this client.</p> : runs.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2 text-sm first:border-0 first:pt-0">
                <span>{r.postCount} posts for <Link href={`/content?client=${client.id}&m=${r.planMonth}`} className="underline">{r.planMonth}</Link> <span className="text-muted">· {r.createdAt.toLocaleDateString("en-GB")}</span></span>
                <form action={undoPlanAction}>
                  <input type="hidden" name="runId" value={r.id} /><input type="hidden" name="clientId" value={client.id} /><input type="hidden" name="month" value={month} />
                  <ConfirmButton title="Discard the untouched drafts of this plan?" message="Posts nobody has edited or moved on are deleted. Edited posts and posts already in review stay." confirmLabel="Discard drafts">Discard untouched drafts</ConfirmButton>
                </form>
              </div>
            ))}
          </section>
          <p className="text-xs text-muted">AI images: {imagesOn ? "on. Use “Make image with AI” on a post's page." : "not configured. A Super Admin adds the Google Gemini key in Settings → Integrations."}</p>
        </>
      )}
    </div>
  );
}
