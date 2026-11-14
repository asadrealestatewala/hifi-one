"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { QuizQuestion } from "@/lib/partner-academy";
import { type SubmitResult, startQuizAction, submitQuizAction } from "../actions";

const LETTERS = "ABCDEF";

// The lesson's quick check: start, answer, see the result. A retake draws a fresh set of questions.
// It stays mounted when the page refreshes after a pass, so the result (and any certificate news) stays on screen.
export default function QuickCheck({ lessonId, ready, done, score, size, hasVideo, nextHref, nextLabel }: { lessonId: string; ready: boolean; done: boolean; score: string | null; size: number; hasVideo: boolean; nextHref: string; nextLabel: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [attempt, setAttempt] = useState<{ id: string; questions: QuizQuestion[] } | null>(null);
  const [answers, setAnswers] = useState<Record<string, number[]>>({});
  const [result, setResult] = useState<Extract<SubmitResult, { ok: true }> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const begin = () => start(async () => {
    setError(null); setResult(null); setAnswers({});
    const r = await startQuizAction(lessonId);
    if (!r.ok) { setError(r.error); return; }
    setAttempt({ id: r.attemptId, questions: r.questions });
  });
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!attempt) return;
    start(async () => {
      const r = await submitQuizAction(attempt.id, answers);
      if (!r.ok) { setError(r.error); return; }
      setResult(r); setAttempt(null);
      if (r.passed) router.refresh();
    });
  };
  const pick = (q: QuizQuestion, i: number, on: boolean) => setAnswers((a) => {
    const cur = a[q.id] ?? [];
    return { ...a, [q.id]: q.multiple ? (on ? [...cur, i] : cur.filter((x) => x !== i)) : [i] };
  });
  const allAnswered = attempt?.questions.every((q) => (answers[q.id] ?? []).length > 0) ?? false;

  return (
    <section className="card space-y-3" aria-labelledby="qc-title">
      <h2 id="qc-title" className="font-semibold">Quick check</h2>
      {error && <p role="alert" className="text-sm text-brand">{error}</p>}
      {!ready && !done && <p className="text-sm text-muted">{hasVideo ? "Watch the video first. The quick check opens when you have watched most of it." : "Mark the lesson as read first."}</p>}

      {result && (
        <div className="space-y-2" aria-live="polite">
          <p className={`font-medium ${result.passed ? "text-success" : "text-brand"}`}>{result.passed ? `Passed: ${result.correctCount} of ${result.total} right.` : `${result.correctCount} of ${result.total} right. You may get one wrong, so try again: you will get a fresh set of questions.`}</p>
          {result.certificates > 0 && <p className="text-sm">You finished the course, and your training certificate has been issued. It is on your <Link className="underline" href="/partner">overview</Link>, ready to download or add to LinkedIn.</p>}
          {result.results.some((r) => !r.right) && (
            <ul className="space-y-1 text-sm">
              {result.results.filter((r) => !r.right).map((r) => <li key={r.id}><span className="font-medium">Missed:</span> {r.text}{r.explanation && <span className="block text-muted">{r.explanation}</span>}</li>)}
            </ul>
          )}
          {result.passed ? <Link className="btn inline-block" href={nextHref}>{nextLabel}</Link> : <button type="button" className="btn" onClick={begin} disabled={pending}>{pending ? "Loading…" : "Try again"}</button>}
        </div>
      )}

      {done && !result && (
        <div className="space-y-2">
          <p className="text-sm">You finished this lesson{score ? ` (quick check ${score})` : ""}.</p>
          <Link className="btn inline-block" href={nextHref}>{nextLabel}</Link>
        </div>
      )}

      {ready && !done && !attempt && !result && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted">{size} questions on this lesson. You may get one wrong.</p>
          <button type="button" className="btn" onClick={begin} disabled={pending}>{pending ? "Loading…" : "Start the quick check"}</button>
        </div>
      )}

      {attempt && (
        <form onSubmit={submit} className="space-y-4">
          {attempt.questions.map((q, n) => (
            <fieldset key={q.id} className="space-y-1.5">
              <legend className="text-sm font-medium">{n + 1}. {q.text}{q.multiple && <span className="font-normal text-muted"> (choose all that apply)</span>}</legend>
              {q.options.map((o, i) => (
                <label key={i} className="flex items-start gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:bg-hover">
                  <input type={q.multiple ? "checkbox" : "radio"} name={q.id} className="mt-0.5" checked={(answers[q.id] ?? []).includes(i)} onChange={(e) => pick(q, i, e.target.checked)} />
                  <span><span className="text-muted">{LETTERS[i]}.</span> {o}</span>
                </label>
              ))}
            </fieldset>
          ))}
          <button type="submit" className="btn" disabled={pending || !allAnswered} aria-disabled={pending || !allAnswered}>{pending ? "Checking…" : "Submit answers"}</button>
          {!allAnswered && <p className="text-xs text-muted">Answer every question to submit.</p>}
        </form>
      )}
    </section>
  );
}
