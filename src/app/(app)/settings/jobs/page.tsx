import { revalidatePath } from "next/cache";
import { audit, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { JOBS, jobKeys, runJobs } from "@/lib/jobs";
import { Badge, ConfirmButton, Notice, PageHeader, StatusBadge } from "@/components/ui";

export const dynamic = "force-dynamic";

async function runNow(formData: FormData): Promise<void> {
  "use server";
  const user = await requirePermission("jobs.run");
  const key = String(formData.get("key") ?? "");
  if (!jobKeys.includes(key)) return;
  const r = await runJobs(db, { trigger: "MANUAL", force: true, only: [key], organizationId: user.organizationId, startedById: user.id });
  await audit(user, { action: "job.run", entity: "Job", entityId: key, after: { status: r[0]?.status, summary: r[0]?.summary } });
  revalidatePath("/settings/jobs");
}

export default async function JobsPage() {
  const user = await requirePermission("jobs.run");
  const org = user.organizationId;
  const runs = await db.jobRun.findMany({ where: { organizationId: org }, orderBy: { startedAt: "desc" }, take: 60 });
  const last = new Map<string, (typeof runs)[number]>();
  for (const r of runs) if (!last.has(r.key)) last.set(r.key, r);
  const automatic = process.env.JOBS_AUTORUN === "1";
  const endpoint = Boolean(process.env.JOBS_TOKEN && process.env.JOBS_TOKEN.length >= 24);
  return (
    <div className="space-y-5">
      <PageHeader title="Scheduled jobs" subtitle="The daily work that keeps billing, reminders and cleanup moving without anyone pressing a button." />
      <section className="card space-y-1 text-sm">
        <h2 className="font-semibold">How they run</h2>
        <p>In-server scheduler: {automatic ? <Badge tone="success">on</Badge> : <Badge tone="warning">off</Badge>} <span className="text-muted">(set JOBS_AUTORUN=1)</span></p>
        <p>Scheduler endpoint <code>/api/jobs/run</code>: {endpoint ? <Badge tone="success">enabled</Badge> : <Badge tone="warning">not configured</Badge>} <span className="text-muted">(set JOBS_TOKEN to 24 or more characters)</span></p>
        <p>Command line: <code>npm run jobs:run</code> from a daily Task Scheduler or cron entry.</p>
        <p className="text-muted">Each job runs at most once a day per organization. Nothing here issues invoices or posts money: billing creates drafts for finance to review.</p>
      </section>
      {!automatic && !endpoint && <Notice kind="error">No automatic schedule is set up, so jobs only run when you press Run now or run the command. See the lines above.</Notice>}
      <div className="grid gap-4 md:grid-cols-2">
        {JOBS.map((j) => {
          const r = last.get(j.key);
          return (
            <section key={j.key} className="card space-y-2">
              <div className="flex items-start justify-between gap-2"><h2 className="font-semibold">{j.label}</h2>{r ? <StatusBadge status={r.status === "OK" ? "COMPLETED" : r.status} /> : <Badge>never run</Badge>}</div>
              <p className="text-sm text-muted">{j.what}</p>
              <p className="text-xs text-muted">{r ? `Last run ${r.startedAt.toLocaleString()} (${r.trigger.toLowerCase()}): ${r.summary ?? r.error ?? "running"}` : "Has not run yet."}</p>
              <form action={runNow}><input type="hidden" name="key" value={j.key} />
                <ConfirmButton title={`Run ${j.label} now?`} message="It runs immediately, even if it already ran today. It is safe to repeat: work already done is not done twice." confirmLabel="Run now">Run now</ConfirmButton>
              </form>
            </section>
          );
        })}
      </div>
      <section className="card !p-0">
        <h2 className="border-b border-border px-5 py-3 font-semibold">Recent runs</h2>
        {runs.length === 0 ? <p className="px-5 py-4 text-sm text-muted">Nothing has run yet.</p> : (
          <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-hover/60 text-left text-xs text-muted"><tr><th className="px-5 py-2.5">When</th><th className="pr-4">Job</th><th className="pr-4">How</th><th className="pr-4">Result</th></tr></thead>
            <tbody>{runs.slice(0, 30).map((r) => <tr key={r.id} className="border-t border-border"><td className="whitespace-nowrap px-5 py-2">{r.startedAt.toLocaleString()}</td><td className="pr-4">{JOBS.find((j) => j.key === r.key)?.label ?? r.key}</td><td className="pr-4 text-muted">{r.trigger.toLowerCase()}</td><td className="pr-4">{r.status === "FAILED" ? <span className="text-brand">{r.error}</span> : r.summary}</td></tr>)}</tbody></table></div>
        )}
      </section>
    </div>
  );
}
