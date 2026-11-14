import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { academyProgress, academyWeek } from "@/lib/partner-academy";
import { partnerId } from "@/lib/partner-stack";
import { paging } from "@/lib/paging";
import { Badge, Empty, Notice, PageHeader, Pager, SearchBox, StatusBadge } from "@/components/ui";
import ScreenTabs from "@/components/shell/ScreenTabs";
import SubmitButton from "@/components/ui/SubmitButton";
import { saveCourseAction } from "./actions";

export const dynamic = "force-dynamic";

type SP = { q?: string; show?: string; page?: string; saved?: string; error?: string };
const when = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

// The Partner Academy: the courses partners take in the portal, and how far each partner has got.
export default async function Academy({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePermission("partners.manage");
  const sp = await searchParams;
  const org = user.organizationId;
  const q = sp.q?.trim();
  const show = sp.show === "renewal" ? "renewal" : undefined;
  const pg = paging(sp.page);
  const now = new Date();
  const [courses, solutions, progress, week] = await Promise.all([
    db.academyCourse.findMany({
      where: { organizationId: org }, include: { product: { select: { name: true, sortOrder: true } }, lessons: { select: { status: true, isUpdate: true, _count: { select: { questions: { where: { status: "PUBLISHED" } } } } } } },
    }),
    db.saasProduct.findMany({ where: { organizationId: org, active: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { code: true, name: true, id: true } }),
    academyProgress(db, org, { q, show, skip: pg.skip, take: pg.take, now }),
    academyWeek(db, org, now),
  ]);
  courses.sort((a, b) => (a.productId === null ? -1 : b.productId === null ? 1 : (a.product?.sortOrder ?? 0) - (b.product?.sortOrder ?? 0)));
  const hasFoundations = courses.some((c) => c.productId === null);
  const free = solutions.filter((s) => !courses.some((c) => c.productId === s.id));
  const href = (n: number) => `/partner-stack/academy?${new URLSearchParams({ ...(q ? { q } : {}), ...(show ? { show } : {}), page: String(n) })}`;
  const stats: [string, string, string?][] = [
    ["Training certificates issued", String(week.trainingIssued)],
    ["Final tests passed", `${week.finalPassed} of ${week.finalTaken}`],
    ["Refresher tests passed", `${week.refresherPassed} of ${week.refresherTaken}`],
    ["Expiring in 30 days", String(week.expiringIn30), "/partner-stack/academy?show=renewal"],
  ];
  return (
    <div className="space-y-5">
      <PageHeader tabs={<ScreenTabs group="partner-stack" current="/partner-stack/academy" />} title="Partner Stack"
        subtitle="Partner Academy: the training partners take in their portal. Finishing the foundations course and a Solution's course issues that Solution's training certificate automatically." />
      {sp.saved && <Notice kind="ok">{sp.saved}</Notice>}
      {sp.error && <Notice kind="error">{sp.error}</Notice>}

      <section className="space-y-2" aria-labelledby="week">
        <h2 id="week" className="font-semibold">Last 7 days</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {stats.map(([label, value, link]) => (
            <div key={label} className="card">
              <p className="text-xs text-muted">{label}</p>
              <p className="text-xl font-semibold tabular-nums">{link && value !== "0" ? <Link className="underline" href={link}>{value}</Link> : value}</p>
            </div>
          ))}
        </div>
        {(week.expiredThisWeek > 0 || week.coursesShort.length > 0) && (
          <p className="text-sm text-muted">
            {week.expiredThisWeek > 0 && <>{week.expiredThisWeek} certificate{week.expiredThisWeek === 1 ? "" : "s"} of authorisation expired this week without renewal. </>}
            {week.coursesShort.length > 0 && <>Tests short of questions: {week.coursesShort.join(", ")}.</>}
          </p>
        )}
        <p className="text-xs text-muted">Everyone who manages partners gets this summary by email every Monday.</p>
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold">Courses</h2>
        {courses.length === 0 ? (
          <Empty title="No courses yet">Start with the foundations course (how the programme, commissions and the portal work), then one course per Solution.</Empty>
        ) : (
          <div className="card !p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left"><th className="px-4 py-2.5">Course</th><th className="pr-4">For</th><th className="pr-4">Lessons published</th><th className="pr-4">Status</th></tr></thead>
              <tbody className="divide-y divide-border">
                {courses.map((c) => {
                  const req = c.lessons.filter((l) => !l.isUpdate);
                  return (
                    <tr key={c.id}>
                      <td className="px-4 py-2.5"><Link className="font-medium underline" href={`/partner-stack/academy/${c.id}`}>{c.title}</Link></td>
                      <td className="pr-4">{c.product?.name ?? "Foundations (every partner)"}</td>
                      <td className="pr-4">{req.filter((l) => l.status === "PUBLISHED").length} of {req.length}{c.lessons.length > req.length && <span className="text-muted"> · {c.lessons.length - req.length} what&rsquo;s new</span>}</td>
                      <td className="pr-4"><StatusBadge status={c.status} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {(free.length > 0 || !hasFoundations) && (
          <form action={saveCourseAction} className="card grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <input type="hidden" name="status" value="DRAFT" />
            <div><label className="label" htmlFor="nc-sol">New course for</label>
              <select id="nc-sol" name="solutionCode" className="input">
                {!hasFoundations && <option value="">Foundations (every partner takes it first)</option>}
                {free.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
              </select></div>
            <div><label className="label" htmlFor="nc-title">Title</label><input id="nc-title" name="title" required minLength={3} maxLength={120} className="input" placeholder="Selling Agentify ERP" /></div>
            <SubmitButton>Add course</SubmitButton>
          </form>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold">Partner progress</h2>
          <div className="flex flex-wrap items-center gap-2">
            <nav aria-label="Filter partners" className="flex gap-1 text-sm">
              <Link className={`btn-ghost ${!show ? "font-semibold underline" : ""}`} href={`/partner-stack/academy${q ? `?q=${encodeURIComponent(q)}` : ""}`} aria-current={!show ? "page" : undefined}>All</Link>
              <Link className={`btn-ghost ${show ? "font-semibold underline" : ""}`} href={`/partner-stack/academy?${new URLSearchParams({ ...(q ? { q } : {}), show: "renewal" })}`} aria-current={show ? "page" : undefined}>Renewal due</Link>
            </nav>
            <SearchBox q={q} placeholder="Search partner name or email" />
          </div>
        </div>
        {progress.rows.length === 0 ? (
          <Empty title={q || show ? "No partners match" : "No active partners yet"}>{q || show ? <Link className="underline" href="/partner-stack/academy">Show all partners</Link> : "Partners appear here once their application is approved."}</Empty>
        ) : (
          <div className="card !p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left"><th className="px-4 py-2.5">Partner</th><th className="pr-4">Courses (lessons done, final test)</th><th className="pr-4">Last lesson finished</th></tr></thead>
              <tbody className="divide-y divide-border align-top">
                {progress.rows.map((r) => (
                  <tr key={r.earner.id}>
                    <td className="px-4 py-2.5"><span className="font-medium">{r.earner.name}</span><br /><span className="text-muted">{partnerId(r.earner.partnerNumber)} · {r.earner.type.name}</span></td>
                    <td className="pr-4 py-2.5">
                      {r.courses.length === 0 ? <span className="text-muted">No published course yet</span> : (
                        <ul className="space-y-0.5">{r.courses.map((c) => <li key={c.title}>{c.title}: {c.done} of {c.of}{c.of > 0 && c.done === c.of && <> <Badge tone="success">done</Badge></>}{c.test && <span className="text-muted"> · final test {c.test.passed ? <Badge tone="success">passed</Badge> : `${c.test.tries} tr${c.test.tries === 1 ? "y" : "ies"}, last ${c.test.last ?? 0}%`}</span>}{c.expiresAt && <span className="text-muted"> · {c.expiresAt <= now ? <Badge tone="warning">{`expired ${when(c.expiresAt)}`}</Badge> : c.expiresAt.getTime() - now.getTime() <= 30 * 86_400_000 ? <Badge tone="warning">{`renew by ${when(c.expiresAt)}`}</Badge> : `valid until ${when(c.expiresAt)}`}</span>}</li>)}</ul>
                      )}
                    </td>
                    <td className="pr-4 py-2.5 whitespace-nowrap">{r.lastActivity ? when(r.lastActivity) : <span className="text-muted">Not started</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pager page={pg.page} size={pg.size} total={progress.total} href={href} />
          </div>
        )}
      </section>
    </div>
  );
}
