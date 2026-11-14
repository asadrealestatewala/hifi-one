import Link from "next/link";
import { requirePartnerUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { academyFor, testName, testStatus } from "@/lib/partner-academy";
import { Badge, Empty, Notice, PageHeader, Progress } from "@/components/ui";

export const dynamic = "force-dynamic";

// The partner's Academy: the foundations course, then one course per Solution they sell. Lessons open one after another.
export default async function PartnerAcademy({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { earner } = await requirePartnerUser();
  const sp = await searchParams;
  const courses = await academyFor(db, earner);
  // The final test of each Solution course whose training certificate the partner holds
  const tests = new Map(await Promise.all(courses.filter((c) => c.certificate).map(async (c) => { const st = await testStatus(db, earner, c.course.id); return [c.course.id, { ...st.state, kind: st.kind, cert: st.certificate }] as const; })));
  const day = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Karachi" });
  const byHand = !earner.academyDirectAccess && !(await db.earnerType.findUnique({ where: { id: earner.typeId }, select: { academyRequired: true } }))?.academyRequired;
  return (
    <>
      <PageHeader title="Partner Academy" subtitle="Watch each lesson and answer its quick check. Finishing a Solution's course gives you its training certificate; passing its final test gives you the certificate of authorisation that lets you sell it." />
      {sp.error && <Notice kind="error">{sp.error}</Notice>}
      {courses.length === 0 ? (
        <Empty title="No courses yet">The partner team is preparing the training for your Solutions. We will email you when it opens.</Empty>
      ) : courses.map((c) => (
        <section key={c.course.id} className="card space-y-3" aria-labelledby={`c-${c.course.id}`}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 id={`c-${c.course.id}`} className="font-semibold">{c.course.title}</h2>
              <p className="text-sm text-muted">{c.isFoundations ? "Start here" : c.course.product?.name}{c.course.summary ? ` · ${c.course.summary}` : ""}</p>
            </div>
            {c.certificate ? <Badge tone="success">Training certificate issued</Badge> : !c.open ? <Badge>Opens after the foundations course</Badge> : null}
          </div>
          {c.requiredCount > 0 && <Progress value={c.doneCount} max={c.requiredCount} label={`${c.doneCount} of ${c.requiredCount} lessons done`} />}
          <ol className="divide-y divide-border">
            {c.lessons.map((l) => (
              <li key={l.lesson.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span className="min-w-0">
                  {l.state === "locked" ? <span className="text-muted">{l.lesson.title}</span> : <Link className="font-medium underline" href={`/partner/academy/${l.lesson.id}`}>{l.lesson.title}</Link>}
                  {l.lesson.durationMinutes && <span className="text-muted"> · {l.lesson.durationMinutes} min</span>}
                  {l.lesson.isUpdate && <> <Badge tone="primary">what&rsquo;s new</Badge></>}
                </span>
                <span>{l.state === "done" ? <Badge tone="success">done{l.progress?.quizScore ? ` · ${l.progress.quizScore}` : ""}</Badge> : l.state === "locked" ? <Badge>locked</Badge> : l.progress?.watchedAt ? <Badge tone="warning">quick check to do</Badge> : <Badge tone="primary">to watch</Badge>}</span>
              </li>
            ))}
          </ol>
          {c.certificate && (() => {
            const t = tests.get(c.course.id);
            const name = t ? testName(t.kind) : "final test";
            const exp = t?.cert?.expiresAt ?? null;
            const href = `/partner/academy/test/${c.course.id}`;
            return (
              <div className="rounded-lg border border-border p-3 text-sm">
                <p className="font-medium">{t?.kind === "REFRESHER" ? "Certificate of authorisation" : "Final test: certificate of authorisation"}</p>
                {t?.state === "certified" ? <p>Valid until {t.expiresAt ? day(t.expiresAt) : "further notice"} (<a className="underline" href={`/partners/verify/${t.publicId}`} target="_blank" rel="noopener">{t.publicId}</a>).{t.renewOpensAt && <span className="text-muted"> The refresher test to renew it opens on {day(t.renewOpensAt)}.</span>}</p>
                  : t?.state === "not_ready" ? <p className="text-muted">The {name} opens soon: the partner team is adding the questions.</p>
                  : t?.state === "wait" ? <p className="text-muted">{t.paused ? "All tries used." : "Retake opens soon."} <Link className="underline" href={href}>See when</Link></p>
                  : t?.state === "in_progress" ? <p><Link className="underline font-medium" href={href}>Continue your {name}</Link> (the timer is running)</p>
                  : t?.kind === "REFRESHER" ? <p>{exp && exp <= new Date() ? `Your certificate expired on ${day(exp)}.` : exp ? `Your certificate expires on ${day(exp)}.` : "The partner team asked you to take the refresher test."} Pass the short refresher test to renew it with the same ID. <Link className="btn mt-2 inline-block" href={href}>Take the refresher test</Link></p>
                  : <p>{byHand ? "The partner team issues your certificate of authorisation; you can still take the test to check yourself. " : ""}<Link className="btn mt-2 inline-block" href={href}>Take the final test</Link></p>}
                <p className="mt-1 text-xs text-muted">Your training certificate <a className="underline" href={`/partners/verify/${c.certificate.publicId}`} target="_blank" rel="noopener">{c.certificate.publicId}</a> is on your <Link className="underline" href="/partner">overview</Link>.</p>
              </div>
            );
          })()}
        </section>
      ))}
    </>
  );
}
