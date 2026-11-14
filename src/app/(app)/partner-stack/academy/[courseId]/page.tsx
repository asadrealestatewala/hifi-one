import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { Badge, Empty, Notice, PageHeader, StatusBadge } from "@/components/ui";
import SubmitButton from "@/components/ui/SubmitButton";
import { saveCourseAction, saveLessonAction } from "../actions";

export const dynamic = "force-dynamic";

type SP = { saved?: string; error?: string };

// One course: its details and its lessons in order. Lessons are edited on their own page, where their questions live.
export default async function CoursePage({ params, searchParams }: { params: Promise<{ courseId: string }>; searchParams: Promise<SP> }) {
  const user = await requirePermission("partners.manage");
  const { courseId } = await params;
  const sp = await searchParams;
  const course = await db.academyCourse.findFirst({
    where: { id: courseId, organizationId: user.organizationId },
    include: {
      product: { select: { name: true, code: true } },
      lessons: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], include: { _count: { select: { questions: { where: { status: "PUBLISHED" } } } } } },
    },
  });
  if (!course) notFound();
  const drafts = await db.academyQuestion.groupBy({ by: ["lessonId"], where: { lessonId: { in: course.lessons.map((l) => l.id) }, status: "DRAFT" }, _count: true });
  const draftCount = (id: string) => drafts.find((d) => d.lessonId === id)?._count ?? 0;
  return (
    <div className="space-y-5">
      <PageHeader back={{ href: "/partner-stack/academy", label: "Academy" }} title={course.title} subtitle={course.product ? `${course.product.name} course. Finishing it (after the foundations course) issues the ${course.product.name} training certificate.` : "Foundations course. Every partner takes it before any Solution course."} />
      {sp.saved && <Notice kind="ok">{sp.saved}</Notice>}
      {sp.error && <Notice kind="error">{sp.error}</Notice>}

      <form action={saveCourseAction} className="card space-y-3">
        <input type="hidden" name="id" value={course.id} />
        <input type="hidden" name="solutionCode" value={course.product?.code ?? ""} />
        <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
          <div><label className="label" htmlFor="c-title">Title</label><input id="c-title" name="title" defaultValue={course.title} required minLength={3} maxLength={120} className="input" /></div>
          <div><label className="label" htmlFor="c-status">Status</label>
            <select id="c-status" name="status" defaultValue={course.status} className="input"><option value="DRAFT">Draft (hidden from partners)</option><option value="PUBLISHED">Published</option></select></div>
        </div>
        <div><label className="label" htmlFor="c-sum">What partners learn (shown on their Academy page)</label><textarea id="c-sum" name="summary" rows={2} maxLength={1000} defaultValue={course.summary ?? ""} className="input" /></div>
        <SubmitButton>Save course</SubmitButton>
      </form>

      <section className="space-y-3">
        <h2 className="font-semibold">Lessons</h2>
        {course.lessons.length === 0 ? (
          <Empty title="No lessons yet">Add the first lesson below: a title and the video link. Then add its questions and publish it.</Empty>
        ) : (
          <div className="card !p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left"><th className="px-4 py-2.5">#</th><th className="pr-4">Lesson</th><th className="pr-4">Video</th><th className="pr-4">Questions</th><th className="pr-4">Status</th></tr></thead>
              <tbody className="divide-y divide-border">
                {course.lessons.map((l) => {
                  const pub = l._count.questions;
                  const short = !l.isUpdate && pub < l.quizSize;
                  return (
                    <tr key={l.id}>
                      <td className="px-4 py-2.5 text-muted">{l.sortOrder}</td>
                      <td className="pr-4"><Link className="font-medium underline" href={`/partner-stack/academy/lessons/${l.id}`}>{l.title}</Link>{l.isUpdate && <> <Badge tone="primary">what&rsquo;s new</Badge></>}</td>
                      <td className="pr-4 whitespace-nowrap">{l.videoUrl ? `${l.durationMinutes ? `${l.durationMinutes} min` : "Linked"}` : <span className="text-muted">Notes only</span>}</td>
                      <td className="pr-4 whitespace-nowrap">{l.isUpdate ? <span className="text-muted">No quick check</span> : <>{pub} published{draftCount(l.id) > 0 && <span className="text-muted"> · {draftCount(l.id)} draft</span>}{short && <span className="block text-xs text-brand">needs {l.quizSize} to publish</span>}</>}</td>
                      <td className="pr-4"><StatusBadge status={l.status} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <form action={saveLessonAction} className="card space-y-3">
          <h3 className="font-medium">Add a lesson</h3>
          <input type="hidden" name="courseId" value={course.id} />
          <input type="hidden" name="status" value="DRAFT" />
          <input type="hidden" name="quizSize" value="3" />
          <div className="grid gap-3 sm:grid-cols-2">
            <div><label className="label" htmlFor="nl-title">Title</label><input id="nl-title" name="title" required minLength={3} maxLength={140} className="input" placeholder="Who buys Agentify ERP and why" /></div>
            <div><label className="label" htmlFor="nl-video">Video link</label><input id="nl-video" name="videoUrl" type="url" className="input" placeholder="https://youtu.be/… or https://vimeo.com/…" /></div>
          </div>
          <div><label className="label" htmlFor="nl-notes">Lesson notes (needed when there is no video)</label><textarea id="nl-notes" name="notes" rows={2} maxLength={5000} className="input" /></div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isUpdate" /> What&rsquo;s new lesson (a product update: shown to every partner, no quick check, not needed for the certificate)</label>
          <SubmitButton>Add lesson</SubmitButton>
          <p className="text-xs text-muted">The lesson is saved as a draft. On its page you add the script, the questions, and publish it.</p>
        </form>
      </section>
    </div>
  );
}
