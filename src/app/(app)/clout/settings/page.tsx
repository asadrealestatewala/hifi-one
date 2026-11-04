import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { getQuota, platformHealth, providerSettings } from "@/lib/clout";
import { PROVIDER_IDS, PROVIDER_LABEL, ytDlpVersion } from "@/lib/clout-providers";
import { HARD_MIN_SECONDS, PLAN_DEFAULTS, PLATFORMS } from "@/lib/clout-rules";
import { Badge, Notice, PageHeader, SubmitButton } from "@/components/ui";
import { ago, platformLabel } from "@/components/clout/parts";
import { saveProviderAction, saveQuotaAction } from "../actions";

export const dynamic = "force-dynamic";
const TONE = { OK: "success", DEGRADED: "warning", BLOCKED: "danger" } as const;

export default async function CloutSettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requirePermission("clout.settings");
  const sp = await searchParams;
  const [health, settings, version, clients, quotas, def] = await Promise.all([
    platformHealth(db, user.organizationId), providerSettings(db, user.organizationId), ytDlpVersion(),
    db.client.findMany({ where: { organizationId: user.organizationId, active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.cloutQuota.findMany({ where: { organizationId: user.organizationId, clientId: { not: null } } }),
    getQuota(db, user.organizationId, null),
  ]);
  const used = await db.cloutPost.groupBy({ by: ["cloutCampaignId"], where: { organizationId: user.organizationId, fastLane: true }, _count: true });
  const campaigns = await db.cloutCampaign.findMany({ where: { id: { in: used.map((u) => u.cloutCampaignId) } }, select: { id: true, clientId: true } });
  const fastBy = new Map<string | null, number>();
  for (const u of used) { const k = campaigns.find((c) => c.id === u.cloutCampaignId)?.clientId ?? null; fastBy.set(k, (fastBy.get(k) ?? 0) + u._count); }
  const apify = Boolean(process.env.APIFY_TOKEN);
  const qFor = (clientId: string | null) => quotas.find((q) => q.clientId === clientId);
  const rows: { id: string | null; name: string }[] = [{ id: null, name: "Company default (own campaigns, and clients without their own quota)" }, ...clients.map((c) => ({ id: c.id, name: c.name }))];

  return (
    <div className="space-y-6">
      <PageHeader title="Clout Leader settings" subtitle="Where the numbers come from, and how many posts per client may update every few minutes." actions={<Link href="/clout" className="btn-ghost">Back to Clout Leader</Link>} />
      {sp.error && <Notice kind="error">{sp.error}</Notice>}
      {sp.ok && <Notice kind="ok">{sp.ok}</Notice>}

      <section className="card space-y-3" aria-label="Sources">
        <h2 className="font-semibold">Sources and platform health</h2>
        <p className="text-sm text-muted">yt-dlp: {version ? <>installed, version {version}</> : <span className="text-brand">not found on this server, so nothing can be fetched with it</span>}. Apify: {apify ? "token present" : "not configured (set APIFY_TOKEN on the server to use it as a backup)"}. Only public data of the links we are given is read; no logins or cookies are used.</p>
        <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="text-left text-xs text-muted"><tr><th className="py-2 pr-4">Platform</th><th className="pr-4">Health</th><th className="pr-4">Primary source</th><th className="pr-4">Backup source</th><th className="pr-4"><span className="sr-only">Save</span></th></tr></thead>
          <tbody>{PLATFORMS.map((p) => { const h = health.find((x) => x.platform === p)!; const s = settings[p]; return (
            <tr key={p} className="border-t border-border align-top">
              <td className="py-2 pr-4 font-medium">{platformLabel(p)}</td>
              <td className="pr-4"><Badge tone={TONE[h.health]}>{h.health === "OK" ? "OK" : h.health === "DEGRADED" ? "Degraded" : "Blocked"}</Badge>
                <p className="mt-1 max-w-xs text-xs text-muted">{h.lastOkAt ? `Last good answer ${ago(h.lastOkAt)}.` : "No answer yet."}{h.health !== "OK" && h.lastError ? ` ${h.lastError}` : ""}{h.backoffUntil && h.backoffUntil > new Date() ? " Requests are paused for a while." : ""}</p></td>
              <td colSpan={3}><form action={saveProviderAction} className="flex flex-wrap items-center gap-2" aria-label={`${platformLabel(p)} sources`}>
                <input type="hidden" name="platform" value={p} />
                <select name="primary" defaultValue={s.primary} className="input !w-auto" aria-label={`${platformLabel(p)} primary source`}>{PROVIDER_IDS.map((id) => <option key={id} value={id}>{PROVIDER_LABEL[id]}</option>)}</select>
                <select name="fallback" defaultValue={s.fallback ?? "NONE"} className="input !w-auto" aria-label={`${platformLabel(p)} backup source`}><option value="NONE">No backup</option>{PROVIDER_IDS.map((id) => <option key={id} value={id}>{PROVIDER_LABEL[id]}</option>)}</select>
                <SubmitButton pendingText="Saving…">Save</SubmitButton></form></td>
            </tr>); })}</tbody></table></div>
        <p className="text-xs text-muted">If the primary source fails or is refused, the backup is tried automatically and the post records which source answered.</p>
      </section>

      <section className="card space-y-3" aria-label="Fast-lane quotas">
        <h2 className="font-semibold">Fast-lane quotas</h2>
        <p className="text-sm text-muted">A fast-lane post updates every {HARD_MIN_SECONDS} seconds to 5 minutes. Posts beyond a client&apos;s quota fall back to 15 minutes and the screen says so. Plans: Free {PLAN_DEFAULTS.FREE}, Standard {PLAN_DEFAULTS.STANDARD}, Pro {PLAN_DEFAULTS.PRO}, or a custom number. Nothing can update faster than every {HARD_MIN_SECONDS} seconds.</p>
        <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="text-left text-xs text-muted"><tr><th className="py-2 pr-4">Client</th><th className="pr-4">Fast posts in use</th><th className="pr-4">Plan and limits</th></tr></thead>
          <tbody>{rows.map((r) => { const q = qFor(r.id); const eff = r.id ? q ?? null : q ?? null; return (
            <tr key={r.id ?? "default"} className="border-t border-border align-top">
              <td className="py-2 pr-4 font-medium">{r.name}</td>
              <td className="pr-4 tabular-nums">{fastBy.get(r.id) ?? 0} of {(eff?.fastPosts ?? def.fastPosts)}{!eff && r.id && <span className="block text-xs font-normal text-muted">default</span>}</td>
              <td><form action={saveQuotaAction} className="flex flex-wrap items-end gap-2" aria-label={`Quota for ${r.name}`}>
                <input type="hidden" name="clientId" value={r.id ?? ""} />
                <div><label className="sr-only" htmlFor={`plan-${r.id ?? "d"}`}>Plan</label><select id={`plan-${r.id ?? "d"}`} name="plan" defaultValue={eff?.plan ?? "FREE"} className="input !w-auto"><option value="FREE">Free ({PLAN_DEFAULTS.FREE})</option><option value="STANDARD">Standard ({PLAN_DEFAULTS.STANDARD})</option><option value="PRO">Pro ({PLAN_DEFAULTS.PRO})</option><option value="CUSTOM">Custom</option></select></div>
                <div><label className="sr-only" htmlFor={`fp-${r.id ?? "d"}`}>Fast posts (custom plan)</label><input id={`fp-${r.id ?? "d"}`} name="fastPosts" type="number" min={0} max={100000} defaultValue={eff?.plan === "CUSTOM" ? eff.fastPosts : ""} placeholder="Custom: posts" className="input !w-32" /></div>
                <div><label className="sr-only" htmlFor={`ms-${r.id ?? "d"}`}>Fastest update in seconds</label><input id={`ms-${r.id ?? "d"}`} name="minSeconds" type="number" min={HARD_MIN_SECONDS} max={3600} defaultValue={eff?.minSeconds ?? HARD_MIN_SECONDS} className="input !w-24" title="Fastest allowed update, in seconds" /></div>
                <SubmitButton pendingText="Saving…">Save</SubmitButton></form></td>
            </tr>); })}</tbody></table></div>
      </section>
    </div>
  );
}
