"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { audit, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  AcademyError, addQuestion, deleteLesson, draftQuestionsWithClaude, importQuestions, saveCourse, saveLesson, setQuestionStatus, updateQuestion,
} from "@/lib/partner-academy";

const str = (f: FormData, k: string) => String(f.get(k) ?? "");
const go = (base: string, extra: string): never => redirect(`${base}${base.includes("?") ? "&" : "?"}${extra}`);
const fail = (base: string, e: unknown): never => {
  if (e instanceof AcademyError) return go(base, `error=${encodeURIComponent(e.message)}`);
  throw e;
};
// The question form: text, answers answer_0..answer_5, the correct ones ticked correct_0..correct_5, explanation
const questionInput = (f: FormData) => ({
  text: str(f, "text"),
  options: Array.from({ length: 6 }, (_, i) => str(f, `answer_${i}`)),
  correct: [] as number[],
  explanation: str(f, "explanation"),
});
// Answers left empty are dropped, so the ticks are mapped onto the answers that remain
function readQuestion(f: FormData) {
  const raw = questionInput(f);
  const kept = raw.options.map((a, i) => ({ a: a.trim(), i })).filter((x) => x.a);
  return { ...raw, options: kept.map((x) => x.a), correct: kept.flatMap((x, idx) => (f.get(`correct_${x.i}`) === "on" ? [idx] : [])) };
}

export async function saveCourseAction(formData: FormData): Promise<void> {
  const user = await requirePermission("partners.manage");
  const id = str(formData, "id") || undefined;
  const base = id ? `/partner-stack/academy/${id}` : "/partner-stack/academy";
  let courseId = id;
  try {
    const { before, after } = await saveCourse(db, { organizationId: user.organizationId, id, solutionCode: str(formData, "solutionCode"), title: str(formData, "title"), summary: str(formData, "summary"), status: str(formData, "status"), actorId: user.id });
    courseId = after.id;
    await audit(user, { action: id ? "partner.academy.course.update" : "partner.academy.course.create", entity: "AcademyCourse", entityId: after.id, before: before ? { title: before.title, status: before.status } : undefined, after: { title: after.title, status: after.status, productId: after.productId } });
  } catch (e) { fail(base, e); }
  revalidatePath("/partner-stack/academy");
  go(`/partner-stack/academy/${courseId}`, "saved=Course saved.");
}

export async function saveLessonAction(formData: FormData): Promise<void> {
  const user = await requirePermission("partners.manage");
  const courseId = str(formData, "courseId");
  const id = str(formData, "id") || undefined;
  const base = id ? `/partner-stack/academy/lessons/${id}` : `/partner-stack/academy/${courseId}`;
  let lessonId = id;
  try {
    const { before, after } = await saveLesson(db, {
      organizationId: user.organizationId, courseId, id, title: str(formData, "title"), videoUrl: str(formData, "videoUrl"), durationMinutes: str(formData, "durationMinutes"),
      script: str(formData, "script"), notes: str(formData, "notes"), sortOrder: str(formData, "sortOrder"), quizSize: str(formData, "quizSize") || "3",
      isUpdate: formData.get("isUpdate") === "on", status: str(formData, "status"),
    });
    lessonId = after.id;
    await audit(user, { action: id ? "partner.academy.lesson.update" : "partner.academy.lesson.create", entity: "AcademyLesson", entityId: after.id, before: before ? { title: before.title, status: before.status, videoUrl: before.videoUrl } : undefined, after: { title: after.title, status: after.status, videoUrl: after.videoUrl } });
  } catch (e) { fail(base, e); }
  revalidatePath("/partner-stack/academy");
  go(`/partner-stack/academy/lessons/${lessonId}`, "saved=Lesson saved.");
}

export async function deleteLessonAction(formData: FormData): Promise<void> {
  const user = await requirePermission("partners.manage");
  const id = str(formData, "id");
  let courseId = "";
  try {
    const l = await deleteLesson(db, { organizationId: user.organizationId, id });
    courseId = l.courseId;
    await audit(user, { action: "partner.academy.lesson.delete", entity: "AcademyLesson", entityId: id, before: { title: l.title } });
  } catch (e) { fail(`/partner-stack/academy/lessons/${id}`, e); }
  revalidatePath("/partner-stack/academy");
  go(`/partner-stack/academy/${courseId}`, "saved=Lesson deleted.");
}

export async function addQuestionAction(formData: FormData): Promise<void> {
  const user = await requirePermission("partners.manage");
  const lessonId = str(formData, "lessonId");
  const base = `/partner-stack/academy/lessons/${lessonId}`;
  try {
    const q = await addQuestion(db, { organizationId: user.organizationId, lessonId, input: readQuestion(formData), actorId: user.id });
    await audit(user, { action: "partner.academy.question.create", entity: "AcademyQuestion", entityId: q.id, after: { lessonId } });
  } catch (e) { fail(base, e); }
  revalidatePath(base);
  go(base, "saved=Question added as a draft. Publish it when it reads right.#questions");
}

export async function updateQuestionAction(formData: FormData): Promise<void> {
  const user = await requirePermission("partners.manage");
  const lessonId = str(formData, "lessonId");
  const id = str(formData, "id");
  const base = `/partner-stack/academy/lessons/${lessonId}`;
  try {
    const { before, after } = await updateQuestion(db, { organizationId: user.organizationId, id, input: readQuestion(formData) });
    await audit(user, { action: "partner.academy.question.update", entity: "AcademyQuestion", entityId: id, before: { text: before.text }, after: { text: after.text } });
  } catch (e) { fail(base, e); }
  revalidatePath(base);
  go(base, "saved=Draft updated.#questions");
}

export async function questionStatusAction(formData: FormData): Promise<void> {
  const user = await requirePermission("partners.manage");
  const lessonId = str(formData, "lessonId");
  const id = str(formData, "id");
  const action = str(formData, "action");
  const base = `/partner-stack/academy/lessons/${lessonId}`;
  try {
    await setQuestionStatus(db, { organizationId: user.organizationId, id, action });
    await audit(user, { action: `partner.academy.question.${action}`, entity: "AcademyQuestion", entityId: id });
  } catch (e) { fail(base, e); }
  revalidatePath(base);
  go(base, `saved=${action === "publish" ? "Question published." : action === "retire" ? "Question retired." : "Draft deleted."}#questions`);
}

export async function importQuestionsAction(formData: FormData): Promise<void> {
  const user = await requirePermission("partners.manage");
  const lessonId = str(formData, "lessonId");
  const base = `/partner-stack/academy/lessons/${lessonId}`;
  let count = 0;
  try {
    const file = formData.get("file");
    if (file instanceof File && file.size > 1_000_000) throw new AcademyError("That file is over 1 MB. Split it into smaller files.");
    const fromFile = file instanceof File && file.size > 0 ? await file.text() : "";
    const r = await importQuestions(db, { organizationId: user.organizationId, lessonId, sheet: fromFile || str(formData, "sheet"), actorId: user.id });
    count = r.count;
    await audit(user, { action: "partner.academy.question.import", entity: "AcademyLesson", entityId: lessonId, after: { count } });
  } catch (e) { fail(base, e); }
  revalidatePath(base);
  go(base, `saved=${count} question${count === 1 ? "" : "s"} imported as drafts. Read them, then publish.#questions`);
}

export async function draftQuestionsAction(formData: FormData): Promise<void> {
  const user = await requirePermission("partners.manage");
  const lessonId = str(formData, "lessonId");
  const base = `/partner-stack/academy/lessons/${lessonId}`;
  let msg = "";
  try {
    const r = await draftQuestionsWithClaude(db, { organizationId: user.organizationId, lessonId, actorId: user.id, count: Number(str(formData, "count")) || 10 });
    msg = `Claude drafted ${r.count} question${r.count === 1 ? "" : "s"}${r.skipped ? ` (${r.skipped} failed the checks and were left out)` : ""}. Read each one, fix or delete it, then publish.`;
    await audit(user, { action: "partner.academy.question.draft_ai", entity: "AcademyLesson", entityId: lessonId, after: { count: r.count } });
  } catch (e) { fail(base, e); }
  revalidatePath(base);
  go(base, `saved=${encodeURIComponent(msg)}#questions`);
}
