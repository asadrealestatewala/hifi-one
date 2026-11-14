import { notFound, redirect } from "next/navigation";
import { requirePartnerUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { AcademyError, WATCHED_PCT, lessonForPartner, parseVideoUrl } from "@/lib/partner-academy";
import { Badge, PageHeader } from "@/components/ui";
import SubmitButton from "@/components/ui/SubmitButton";
import { markReadAction } from "../actions";
import LessonPlayer from "./LessonPlayer";
import QuickCheck from "./QuickCheck";

export const dynamic = "force-dynamic";

// One lesson: the video (or the notes), then the quick check. Locked lessons send the partner back to the Academy.
export default async function PartnerLesson({ params }: { params: Promise<{ lessonId: string }> }) {
  const { earner } = await requirePartnerUser();
  const { lessonId } = await params;
  let view: Awaited<ReturnType<typeof lessonForPartner>>;
  try { view = await lessonForPartner(db, earner, lessonId); }
  catch (e) {
    if (e instanceof AcademyError && e.status === 403) redirect(`/partner/academy?error=${encodeURIComponent(e.message)}`);
    if (e instanceof AcademyError) notFound();
    throw e;
  }
  const { lesson, progress, state, course, nextLessonId } = view;
  const video = parseVideoUrl(lesson.videoUrl);
  const watched = Boolean(progress?.watchedAt);
  return (
    <>
      <PageHeader back={{ href: "/partner/academy", label: "Academy" }} title={lesson.title}
        subtitle={<>{course.title}{lesson.durationMinutes ? ` · ${lesson.durationMinutes} min` : ""} {state === "done" && <Badge tone="success">done</Badge>}</>} />
      {video ? (
        <LessonPlayer lessonId={lesson.id} video={video} title={lesson.title} initialPct={progress?.watchedPct ?? 0} threshold={WATCHED_PCT} />
      ) : !watched ? (
        <form action={markReadAction} className="card flex flex-wrap items-center justify-between gap-3">
          <input type="hidden" name="lessonId" value={lesson.id} />
          <p className="text-sm">This lesson has no video. Read the notes below, then mark it as read.</p>
          <SubmitButton>Mark as read</SubmitButton>
        </form>
      ) : null}
      {lesson.notes && (
        <section className="card space-y-2">
          <h2 className="font-semibold">Lesson notes</h2>
          <div className="whitespace-pre-line text-sm">{lesson.notes}</div>
        </section>
      )}
      {!lesson.isUpdate && (
        <QuickCheck lessonId={lesson.id} ready={watched} done={state === "done"} score={progress?.quizScore ?? null} size={lesson.quizSize} hasVideo={Boolean(video)}
          nextHref={nextLessonId ? `/partner/academy/${nextLessonId}` : "/partner/academy"} nextLabel={nextLessonId ? "Next lesson" : "Back to the Academy"} />
      )}
    </>
  );
}
