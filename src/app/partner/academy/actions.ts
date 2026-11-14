"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePartnerUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { AcademyError, type QuizQuestion, recordWatch, saveTestAnswers, startQuiz, startTest, submitQuiz, submitTest } from "@/lib/partner-academy";

// Every action reads the partner from the session, never from the request.
const who = (e: { id: string; organizationId: string; name: string }) => ({ id: e.id, organizationId: e.organizationId, name: e.name });

export type WatchResult = { ok: true; watchedPct: number; watched: boolean; certificates: number } | { ok: false; error: string };
export async function recordWatchAction(lessonId: string, pct: number): Promise<WatchResult> {
  const { earner } = await requirePartnerUser();
  try {
    const r = await recordWatch(db, { earner: who(earner), lessonId: String(lessonId), pct: Number(pct) });
    if (r.certificates.length) revalidatePath("/partner");
    return { ok: true, watchedPct: r.progress.watchedPct, watched: Boolean(r.progress.watchedAt), certificates: r.certificates.length };
  } catch (e) {
    if (e instanceof AcademyError) return { ok: false, error: e.message };
    throw e;
  }
}

// "Mark as read" for a lesson without a video
export async function markReadAction(formData: FormData): Promise<void> {
  const { earner } = await requirePartnerUser();
  const lessonId = String(formData.get("lessonId") ?? "");
  try { await recordWatch(db, { earner: who(earner), lessonId, pct: 100 }); }
  catch (e) { if (e instanceof AcademyError) redirect(`/partner/academy?error=${encodeURIComponent(e.message)}`); throw e; }
  revalidatePath("/partner/academy");
  redirect(`/partner/academy/${encodeURIComponent(lessonId)}`);
}

export type StartResult = { ok: true; attemptId: string; questions: QuizQuestion[] } | { ok: false; error: string };
export async function startQuizAction(lessonId: string): Promise<StartResult> {
  const { earner } = await requirePartnerUser();
  try {
    const r = await startQuiz(db, { earner: who(earner), lessonId: String(lessonId) });
    return { ok: true, ...r };
  } catch (e) {
    if (e instanceof AcademyError) return { ok: false, error: e.message };
    throw e;
  }
}

export type SubmitResult =
  | { ok: true; correctCount: number; total: number; passed: boolean; results: { id: string; text: string; right: boolean; explanation: string | null }[]; certificates: number }
  | { ok: false; error: string };
export async function submitQuizAction(attemptId: string, answers: Record<string, number[]>): Promise<SubmitResult> {
  const { earner } = await requirePartnerUser();
  const clean: Record<string, number[]> = {};
  for (const [k, v] of Object.entries(answers ?? {}).slice(0, 20)) clean[String(k)] = (Array.isArray(v) ? v : []).slice(0, 6).map(Number).filter((n) => Number.isInteger(n));
  try {
    const r = await submitQuiz(db, { earner: who(earner), attemptId: String(attemptId), answers: clean });
    revalidatePath("/partner/academy");
    if (r.certificates.length) revalidatePath("/partner");
    return { ok: true, correctCount: r.correctCount, total: r.total, passed: r.passed, results: r.results.map(({ id, text, right, explanation }) => ({ id, text, right, explanation })), certificates: r.certificates.length };
  } catch (e) {
    if (e instanceof AcademyError) return { ok: false, error: e.message };
    throw e;
  }
}

// ----- Final test -----

export async function startTestAction(formData: FormData): Promise<void> {
  const { earner } = await requirePartnerUser();
  const courseId = String(formData.get("courseId") ?? "");
  const base = `/partner/academy/test/${encodeURIComponent(courseId)}`;
  try { await startTest(db, { earner: who(earner), courseId, declared: formData.get("declared") === "on" }); }
  catch (e) { if (e instanceof AcademyError) redirect(`${base}?error=${encodeURIComponent(e.message)}`); throw e; }
  redirect(base);
}

export type SaveResult = { ok: true } | { ok: false; error: string };
export async function saveTestAnswersAction(attemptId: string, answers: Record<string, number[]>): Promise<SaveResult> {
  const { earner } = await requirePartnerUser();
  try { await saveTestAnswers(db, { earner: who(earner), attemptId: String(attemptId), answers: answers ?? {} }); return { ok: true }; }
  catch (e) { if (e instanceof AcademyError) return { ok: false, error: e.message }; throw e; }
}

export type TestSubmitResult = { ok: true; attemptId: string } | { ok: false; error: string };
export async function submitTestAction(attemptId: string, answers: Record<string, number[]>): Promise<TestSubmitResult> {
  const { earner } = await requirePartnerUser();
  try {
    const r = await submitTest(db, { earner: who(earner), attemptId: String(attemptId), answers: answers ?? {} });
    revalidatePath("/partner/academy");
    if (r.certificateId) revalidatePath("/partner");
    return { ok: true, attemptId: String(attemptId) };
  } catch (e) {
    if (e instanceof AcademyError) return { ok: false, error: e.message };
    throw e;
  }
}
