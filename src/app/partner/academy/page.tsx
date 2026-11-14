import Link from "next/link";
import { requirePartnerUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { academyFor } from "@/lib/partner-academy";
import { Badge, Empty, Notice, PageHeader, Progress } from "@/components/ui";

export const dynamic = "force-dynamic";

// The partner's Academy: the foundations course, then one course per Solution they sell. Lessons open one after another.
export default async function PartnerAcademy({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { earner } = await requirePartnerUser();
  const sp = await searchParams;
  const courses = await academyFor(db, earner);
  return (
    <>
      <PageHeader title="Partner Academy" subtitle="Watch each lesson, then answer a short quick check. Finish the foundations course and a Solution's course to get that Solution's training certificate." />
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
          {c.certificate && <p className="text-sm">Your certificate <a className="underline" href={`/partners/verify/${c.certificate.publicId}`} target="_blank" rel="noopener">{c.certificate.publicId}</a> is on your <Link className="underline" href="/partner">overview</Link>, ready to download or add to LinkedIn.</p>}
        </section>
      ))}
    </>
  );
}
