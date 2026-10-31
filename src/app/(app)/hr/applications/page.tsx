import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { signDownload } from "@/lib/files";
import { APPLICATION_STATUSES } from "@/lib/job-applications";
import { paging } from "@/lib/paging";
import { Chips, Empty, Notice, PageHeader, Pager, SearchBox, StatusBadge } from "@/components/ui";
import Drawer from "@/components/ui/Drawer";
import SubmitButton from "@/components/ui/SubmitButton";
import { updateApplicationAction } from "./actions";

export const dynamic = "force-dynamic";

type SP = { q?: string; status?: string; job?: string; page?: string; open?: string; saved?: string; error?: string };
const label = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();
const when = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

// Applications sent from the careers pages of the public website (hifimarketing.co/site/careers/jobs/...).
export default async function Applications({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePermission("hr.view");
  const sp = await searchParams;
  const org = user.organizationId;
  const canManage = user.permissions.has("hr.manage");
  const q = sp.q?.trim();
  const status = (APPLICATION_STATUSES as readonly string[]).includes(sp.status ?? "") ? sp.status : undefined;
  const jobId = Number.parseInt(sp.job ?? "", 10);
  const where: Prisma.JobApplicationWhereInput = {
    organizationId: org,
    ...(status ? { status } : {}),
    ...(Number.isFinite(jobId) ? { jobId } : {}),
    ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }, { phone: { contains: q } }, { jobTitle: { contains: q, mode: "insensitive" } }] } : {}),
  };
  const pg = paging(sp.page);
  const [rows, total, byStatus, open] = await Promise.all([
    db.jobApplication.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "asc" }], skip: pg.skip, take: pg.take }),
    db.jobApplication.count({ where }),
    db.jobApplication.groupBy({ by: ["status"], where: { organizationId: org }, _count: true }),
    sp.open ? db.jobApplication.findFirst({ where: { id: sp.open, organizationId: org } }) : null,
  ]);
  const cv = open?.cvFileId ? await db.storedFile.findFirst({ where: { id: open.cvFileId, organizationId: org, ownerType: "JOB_APPLICATION", ownerId: open.id, deletedAt: null } }) : null;
  const reviewer = open?.reviewedById ? await db.user.findFirst({ where: { id: open.reviewedById, organizationId: org }, select: { name: true } }) : null;
  const count = new Map(byStatus.map((s) => [s.status, s._count]));
  const all = byStatus.reduce((n, s) => n + s._count, 0);
  const current = { q, status, job: Number.isFinite(jobId) ? String(jobId) : undefined };
  const href = (over: Record<string, string | undefined>) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries({ ...current, ...over })) if (v) p.set(k, v); const t = p.toString(); return `/hr/applications${t ? `?${t}` : ""}`; };
  const closeTo = href({});

  return (
    <div className="space-y-5">
      <PageHeader title="Job applications" subtitle={<>Applications sent from the careers pages of the website. <a className="underline" href="/site/careers/jobs" target="_blank" rel="noopener">See open roles</a></>} />
      <div className="flex flex-wrap items-center gap-3">
        <SearchBox q={q} placeholder="Search name, email, phone or role" hidden={{ ...current, q: undefined }} />
        <Chips current={status ?? "all"} items={[{ key: "all", label: "All", count: all, href: href({ status: undefined, page: undefined }) }, ...APPLICATION_STATUSES.map((s) => ({ key: s, label: label(s), count: count.get(s) ?? 0, href: href({ status: s, page: undefined }) }))]} />
      </div>
      {rows.length === 0 ? (
        <Empty title={all === 0 ? "No applications yet" : "No applications match these filters"}>
          {all === 0 ? "When someone applies for a role on the website's careers pages, their application and CV appear here." : <Link className="underline" href="/hr/applications">Clear filters</Link>}
        </Empty>
      ) : (
        <div className="card !p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left"><th className="px-4 py-2.5">Applicant</th><th className="pr-4">Role</th><th className="pr-4">Contact</th><th className="pr-4">Received</th><th className="pr-4">Status</th></tr></thead>
            <tbody className="divide-y divide-border">
              {rows.map((a) => (
                <tr key={a.id}>
                  <td className="px-4 py-2.5"><Link className="font-medium hover:underline" href={href({ open: a.id })}>{a.name}</Link>{a.submissions > 1 && <span className="ml-2 text-xs text-muted">applied {a.submissions} times</span>}</td>
                  <td className="pr-4"><Link className="hover:underline" href={href({ job: String(a.jobId), page: undefined })}>{a.jobTitle}</Link></td>
                  <td className="pr-4 text-muted">{a.email}<br />{a.phone}</td>
                  <td className="pr-4 whitespace-nowrap">{when(a.createdAt)}</td>
                  <td className="pr-4"><StatusBadge status={a.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pager page={pg.page} size={pg.size} total={total} href={(n) => href({ page: String(n) })} />
        </div>
      )}

      {open && (
        <Drawer title={`${open.name}: ${open.jobTitle}`} closeTo={closeTo}>
          <div className="h-full space-y-5 overflow-y-auto p-5">
            {sp.saved && <Notice kind="ok">Saved.</Notice>}
            {sp.error && <Notice kind="error">{sp.error}</Notice>}
            <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-2 text-sm">
              <dt className="text-muted">Role</dt><dd><a className="underline" href={`/site/careers/jobs/${open.jobId}`} target="_blank" rel="noopener">{open.jobTitle}</a></dd>
              <dt className="text-muted">Email</dt><dd><a className="underline" href={`mailto:${open.email}`}>{open.email}</a></dd>
              <dt className="text-muted">Phone</dt><dd><a className="underline" href={`tel:${open.phone}`}>{open.phone}</a></dd>
              <dt className="text-muted">Profile link</dt><dd>{open.profileUrl ? <a className="underline break-all" href={open.profileUrl} target="_blank" rel="noopener noreferrer">{open.profileUrl}</a> : <span className="text-muted">None</span>}</dd>
              <dt className="text-muted">CV</dt>
              <dd>{cv ? <><a className="underline font-medium" href={`/api/files/${cv.id}?t=${signDownload(cv.id, user.id, process.env.SESSION_SECRET ?? "")}`} target="_blank" rel="noopener">{cv.filename}</a> <span className="text-xs text-muted">· {cv.scanStatus === "CLEAN" ? "virus-checked" : "not virus-scanned"}</span></> : <span className="text-muted">No CV uploaded</span>}</dd>
              <dt className="text-muted">Received</dt><dd>{when(open.createdAt)}{open.submissions > 1 && ` · applied ${open.submissions} times, last ${when(open.updatedAt)}`}</dd>
              {reviewer && <><dt className="text-muted">Last reviewed</dt><dd>{reviewer.name}, {when(open.reviewedAt!)}</dd></>}
            </dl>
            <section>
              <h3 className="mb-1 text-sm font-semibold">Note from the applicant</h3>
              <p className="whitespace-pre-wrap text-sm">{open.coverNote ?? <span className="text-muted">None</span>}</p>
            </section>
            {canManage ? (
              <form action={updateApplicationAction} className="card space-y-3">
                <input type="hidden" name="id" value={open.id} />
                <div><label className="label" htmlFor="app-status">Status</label>
                  <select id="app-status" name="status" defaultValue={open.status} className="input">{APPLICATION_STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}</select></div>
                <div><label className="label" htmlFor="app-notes">HR notes (never shown to the applicant)</label>
                  <textarea id="app-notes" name="notes" defaultValue={open.notes ?? ""} rows={5} maxLength={4000} className="input" /></div>
                <SubmitButton>Save</SubmitButton>
              </form>
            ) : (
              <p className="text-sm"><span className="text-muted">Status:</span> <StatusBadge status={open.status} />{open.notes && <><br /><span className="text-muted">HR notes:</span> {open.notes}</>}</p>
            )}
          </div>
        </Drawer>
      )}
    </div>
  );
}
