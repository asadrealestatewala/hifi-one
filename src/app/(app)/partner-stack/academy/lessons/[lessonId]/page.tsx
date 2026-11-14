import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { isConfigured } from "@/lib/integration-keys";
import { MAX_OPTIONS, parseVideoUrl } from "@/lib/partner-academy";
import { Badge, Empty, Notice, PageHeader, StatusBadge } from "@/components/ui";
import ConfirmButton from "@/components/ui/ConfirmButton";
import SubmitButton from "@/components/ui/SubmitButton";
import { addQuestionAction, deleteLessonAction, draftQuestionsAction, importQuestionsAction, questionStatusAction, saveLessonAction, updateQuestionAction } from "../../actions";

export const dynamic = "force-dynamic";

type SP = { saved?: string; error?: string };
const LETTERS = "ABCDEF";
const SOURCE: Record<string, string> = { MANUAL: "typed", IMPORT: "imported", CLAUDE: "drafted by Claude" };

// The answer rows of the question form; ticks mark the correct ones
function QuestionFields({ prefix, q }: { prefix: string; q?: { text: string; options: string[]; correct: number[]; explanation: string | null } }) {
  return (
    <>
      <div><label className="label" htmlFor={`${prefix}-text`}>Question</label><textarea id={`${prefix}-text`} name="text" rows={2} required minLength={5} maxLength={500} defaultValue={q?.text} className="input" /></div>
      <fieldset className="space-y-2">
        <legend className="label">Answers (tick the correct one; leave spare rows empty)</legend>
        {Array.from({ length: MAX_OPTIONS }, (_, i) => (
          <div key={i} className="flex items-center gap-2">
            <input type="checkbox" name={`correct_${i}`} defaultChecked={q?.correct.includes(i)} aria-label={`Answer ${LETTERS[i]} is correct`} />
            <span className="w-4 text-sm text-muted" aria-hidden>{LETTERS[i]}</span>
            <input name={`answer_${i}`} maxLength={200} defaultValue={q?.options[i] ?? ""} className="input" aria-label={`Answer ${LETTERS[i]}`} required={i < 2} />
          </div>
        ))}
      </fieldset>
      <div><label className="label" htmlFor={`${prefix}-exp`}>Why (shown to a partner who gets it wrong)</label><input id={`${prefix}-exp`} name="explanation" maxLength={500} defaultValue={q?.explanation ?? ""} className="input" /></div>
    </>
  );
}

// A lesson: its video, script and notes, and its question bank (drafts, published, retired).
export default async function LessonPage({ params, searchParams }: { params: Promise<{ lessonId: string }>; searchParams: Promise<SP> }) {
  const user = await requirePermission("partners.manage");
  const { lessonId } = await params;
  const sp = await searchParams;
  const lesson = await db.academyLesson.findFirst({
    where: { id: lessonId, organizationId: user.organizationId },
    include: { course: { include: { product: { select: { name: true } } } }, questions: { orderBy: { createdAt: "asc" } }, _count: { select: { progress: true, attempts: true } } },
  });
  if (!lesson) notFound();
  const claude = await isConfigured(db, user.organizationId, "ANTHROPIC");
  const video = parseVideoUrl(lesson.videoUrl);
  const groups = (["DRAFT", "PUBLISHED", "RETIRED"] as const).map((s) => ({ status: s, rows: lesson.questions.filter((q) => q.status === s) }));
  const published = groups[1].rows.filter((q) => !q.finalOnly).length;
  const finalOnlyCheckbox = <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="finalOnly" /> Final test only (never in this lesson&rsquo;s quick check)</label>;
  const started = lesson._count.progress + lesson._count.attempts > 0;
  return (
    <div className="space-y-5">
      <PageHeader back={{ href: `/partner-stack/academy/${lesson.courseId}`, label: lesson.course.title }} title={lesson.title}
        subtitle={<>Lesson {lesson.sortOrder} of {lesson.course.product?.name ?? "the foundations course"} · <StatusBadge status={lesson.status} /></>} />
      {sp.saved && <Notice kind="ok">{sp.saved}</Notice>}
      {sp.error && <Notice kind="error">{sp.error}</Notice>}

      <form action={saveLessonAction} className="card space-y-3">
        <input type="hidden" name="id" value={lesson.id} />
        <input type="hidden" name="courseId" value={lesson.courseId} />
        <div className="grid gap-3 sm:grid-cols-[1fr_6rem_6rem]">
          <div><label className="label" htmlFor="l-title">Title</label><input id="l-title" name="title" defaultValue={lesson.title} required minLength={3} maxLength={140} className="input" /></div>
          <div><label className="label" htmlFor="l-order">Order</label><input id="l-order" name="sortOrder" type="number" min={0} max={999} defaultValue={lesson.sortOrder} className="input" /></div>
          <div><label className="label" htmlFor="l-min">Minutes</label><input id="l-min" name="durationMinutes" type="number" min={1} max={999} defaultValue={lesson.durationMinutes ?? ""} className="input" /></div>
        </div>
        <div><label className="label" htmlFor="l-video">Video link</label><input id="l-video" name="videoUrl" type="url" defaultValue={lesson.videoUrl ?? ""} className="input" placeholder="https://youtu.be/… (unlisted is fine) or https://vimeo.com/…" />
          {lesson.videoUrl && !video && <p className="mt-1 text-xs text-brand">This link is not a YouTube, Vimeo or .mp4 link.</p>}</div>
        {video && video.provider !== "file" && (
          <div className="aspect-video w-full max-w-xl overflow-hidden rounded-lg border border-border">
            <iframe src={video.embedUrl} title={`Preview: ${lesson.title}`} className="h-full w-full" allow="encrypted-media; fullscreen; picture-in-picture" allowFullScreen />
          </div>
        )}
        <div><label className="label" htmlFor="l-script">Script (what the video says; Claude drafts questions from it, partners do not see it)</label><textarea id="l-script" name="script" rows={6} maxLength={30000} defaultValue={lesson.script ?? ""} className="input" /></div>
        <div><label className="label" htmlFor="l-notes">Lesson notes (shown to partners under the video: key points, links)</label><textarea id="l-notes" name="notes" rows={4} maxLength={5000} defaultValue={lesson.notes ?? ""} className="input" /></div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div><label className="label" htmlFor="l-quiz">Quick check</label>
            <select id="l-quiz" name="quizSize" defaultValue={String(lesson.quizSize)} className="input"><option value="3">3 questions (short lesson)</option><option value="5">5 questions (longer lesson)</option></select></div>
          <div><label className="label" htmlFor="l-status">Status</label>
            <select id="l-status" name="status" defaultValue={lesson.status} className="input"><option value="DRAFT">Draft (hidden from partners)</option><option value="PUBLISHED">Published</option></select></div>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isUpdate" defaultChecked={lesson.isUpdate} /> What&rsquo;s new lesson (no quick check, not needed for the certificate)</label>
        <SubmitButton>Save lesson</SubmitButton>
        {!lesson.isUpdate && <p className="text-xs text-muted">Publishing needs at least {lesson.quizSize} published quick-check questions (this lesson has {published}). About 10 is best: each quick check draws {lesson.quizSize} at random, so a retake shows different ones. Partners pass with at most one wrong answer. Every published question, including &ldquo;final test only&rdquo; ones, can also appear in the Solution&rsquo;s final test.</p>}
      </form>

      {!lesson.isUpdate && (
        <section id="questions" className="space-y-3">
          <h2 className="font-semibold">Questions</h2>
          {lesson.questions.length === 0 && <Empty title="No questions yet">Draft them with Claude from the script, import them from a spreadsheet, or type them below.</Empty>}
          {groups.filter((g) => g.rows.length > 0).map((g) => (
            <div key={g.status} className="card space-y-3">
              <h3 className="font-medium">{g.status === "DRAFT" ? `Drafts (${g.rows.length}): partners do not see these until you publish them` : g.status === "PUBLISHED" ? `Published (${g.rows.length})` : `Retired (${g.rows.length})`}</h3>
              <ol className="space-y-3">
                {g.rows.map((q, n) => (
                  <li key={q.id} className="rounded-lg border border-border p-3 text-sm">
                    <p className="font-medium">{n + 1}. {q.text} <span className="text-xs font-normal text-muted">({SOURCE[q.source] ?? q.source})</span>{q.finalOnly && <> <Badge tone="primary">final test only</Badge></>}</p>
                    <ul className="mt-1 space-y-0.5">
                      {q.options.map((o, i) => <li key={i} className={q.correct.includes(i) ? "font-medium text-success" : ""}>{LETTERS[i]}. {o}{q.correct.includes(i) && <> <Badge tone="success">correct</Badge></>}</li>)}
                    </ul>
                    {q.explanation && <p className="mt-1 text-muted">Why: {q.explanation}</p>}
                    {g.status !== "RETIRED" && (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        {g.status === "DRAFT" && <>
                          <form action={questionStatusAction}><input type="hidden" name="lessonId" value={lesson.id} /><input type="hidden" name="id" value={q.id} /><input type="hidden" name="action" value="publish" /><SubmitButton className="btn !py-1">Publish</SubmitButton></form>
                          <form action={questionStatusAction}><input type="hidden" name="lessonId" value={lesson.id} /><input type="hidden" name="id" value={q.id} /><input type="hidden" name="action" value="delete" /><ConfirmButton title="Delete this draft?" message="The draft question is removed." confirmLabel="Delete">Delete</ConfirmButton></form>
                        </>}
                        {g.status === "PUBLISHED" && (
                          <form action={questionStatusAction}><input type="hidden" name="lessonId" value={lesson.id} /><input type="hidden" name="id" value={q.id} /><input type="hidden" name="action" value="retire" /><ConfirmButton title="Retire this question?" message="Partners stop seeing it. Past quick checks keep it, so their scores stay as they were. To correct it, retire it and add a new one." confirmLabel="Retire">Retire</ConfirmButton></form>
                        )}
                      </div>
                    )}
                    {g.status === "DRAFT" && (
                      <details className="mt-2"><summary className="cursor-pointer text-sm underline">Edit</summary>
                        <form action={updateQuestionAction} className="mt-2 space-y-3">
                          <input type="hidden" name="lessonId" value={lesson.id} /><input type="hidden" name="id" value={q.id} />
                          <QuestionFields prefix={`e-${q.id}`} q={q} />
                          <SubmitButton>Save draft</SubmitButton>
                        </form>
                      </details>
                    )}
                  </li>
                ))}
              </ol>
            </div>
          ))}

          <div className="grid gap-3 lg:grid-cols-2">
            <form action={draftQuestionsAction} className="card space-y-2">
              <h3 className="font-medium">Draft with Claude</h3>
              <input type="hidden" name="lessonId" value={lesson.id} />
              {claude ? (
                <>
                  <p className="text-sm text-muted">Claude reads the saved script and drafts questions as drafts. You read each one, fix or delete it, then publish. It takes up to a minute.</p>
                  <div className="flex items-end gap-2">
                    <div><label className="label" htmlFor="d-count">How many</label><select id="d-count" name="count" defaultValue="10" className="input"><option>5</option><option>10</option><option>15</option></select></div>
                    <SubmitButton pendingText="Drafting…">Draft questions</SubmitButton>
                  </div>
                  {finalOnlyCheckbox}
                  {(!lesson.script || lesson.script.length < 200) && <p className="text-xs text-brand">Paste the script above and save the lesson first.</p>}
                </>
              ) : (
                <p className="text-sm text-muted">Not configured. A Super Admin adds the Anthropic API key in Settings → Integrations. Until then, import or type the questions.</p>
              )}
            </form>
            <form action={importQuestionsAction} className="card space-y-2">
              <h3 className="font-medium">Import from a spreadsheet</h3>
              <input type="hidden" name="lessonId" value={lesson.id} />
              <p className="text-sm text-muted">Columns: Question, Answer A, Answer B, Answer C, Answer D, Correct (a letter, or &ldquo;A,C&rdquo;), Why. Copy the rows from Google Sheets or Excel and paste them, or choose a .csv file. A header row is fine. Everything comes in as drafts.</p>
              <div><label className="label" htmlFor="i-sheet">Paste rows</label><textarea id="i-sheet" name="sheet" rows={4} className="input font-mono text-xs" /></div>
              <div><label className="label" htmlFor="i-file">Or a .csv file</label><input id="i-file" name="file" type="file" accept=".csv,.tsv,.txt,text/csv" className="input" /></div>
              {finalOnlyCheckbox}
              <SubmitButton pendingText="Importing…">Import</SubmitButton>
            </form>
          </div>

          <form action={addQuestionAction} className="card space-y-3">
            <h3 className="font-medium">Type a question</h3>
            <input type="hidden" name="lessonId" value={lesson.id} />
            <QuestionFields prefix="new" />
            {finalOnlyCheckbox}
            <SubmitButton>Add as draft</SubmitButton>
          </form>
        </section>
      )}

      {!started && (
        <form action={deleteLessonAction} className="flex justify-end">
          <input type="hidden" name="id" value={lesson.id} />
          <ConfirmButton title="Delete this lesson?" message="The lesson and its questions are removed. No partner has started it yet." confirmLabel="Delete lesson">Delete lesson</ConfirmButton>
        </form>
      )}
    </div>
  );
}
