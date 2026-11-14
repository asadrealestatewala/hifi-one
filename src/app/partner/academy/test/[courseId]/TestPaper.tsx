"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import type { QuizQuestion } from "@/lib/partner-academy";
import { saveTestAnswersAction, submitTestAction } from "../../actions";

const LETTERS = "ABCDEF";
const clock = (ms: number) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

// The final test paper. Answers are saved every few seconds after a change; at zero the paper submits itself. The server keeps its
// own deadline, so changing this page's clock changes nothing.
export default function TestPaper({ attemptId, courseId, questions, saved, deadline }: { attemptId: string; courseId: string; questions: QuizQuestion[]; saved: Record<string, number[]>; deadline: string }) {
  const router = useRouter();
  const [answers, setAnswers] = useState<Record<string, number[]>>(saved);
  const [left, setLeft] = useState(() => new Date(deadline).getTime() - Date.now());
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<"saved" | "saving" | "unsaved">("saved");
  const [pending, start] = useTransition();
  const latest = useRef(answers);
  const dirty = useRef(false);
  const submitted = useRef(false);
  latest.current = answers;

  const submit = useCallback(() => {
    if (submitted.current) return;
    submitted.current = true;
    start(async () => {
      const r = await submitTestAction(attemptId, latest.current);
      if (!r.ok) { setError(r.error); submitted.current = false; router.refresh(); return; }
      router.replace(`/partner/academy/test/${courseId}?result=${r.attemptId}`);
      router.refresh();
    });
  }, [attemptId, courseId, router]);

  // Countdown and automatic submit
  useEffect(() => {
    const t = setInterval(() => {
      const ms = new Date(deadline).getTime() - Date.now();
      setLeft(ms);
      if (ms <= 0) { clearInterval(t); submit(); }
    }, 1000);
    return () => clearInterval(t);
  }, [deadline, submit]);

  // Save after changes, at most every 5 seconds
  useEffect(() => {
    const t = setInterval(async () => {
      if (!dirty.current || submitted.current) return;
      dirty.current = false;
      setStatus("saving");
      const r = await saveTestAnswersAction(attemptId, latest.current);
      if (!r.ok) { setError(r.error); setStatus("unsaved"); } else setStatus("saved");
    }, 5000);
    return () => clearInterval(t);
  }, [attemptId]);

  const pick = (q: QuizQuestion, i: number, on: boolean) => {
    dirty.current = true;
    setStatus("unsaved");
    setAnswers((a) => { const cur = a[q.id] ?? []; return { ...a, [q.id]: q.multiple ? (on ? [...cur, i] : cur.filter((x) => x !== i)) : [i] }; });
  };
  const answered = questions.filter((q) => (answers[q.id] ?? []).length > 0).length;
  const low = left < 5 * 60_000;

  return (
    <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="space-y-4">
      <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-surface px-4 py-2 shadow-sm">
        <span className={`font-semibold tabular-nums ${low ? "text-brand" : ""}`} role="timer" aria-live={low ? "polite" : "off"} aria-label="Time left">{clock(left)} left</span>
        <span className="text-sm text-muted">{answered} of {questions.length} answered · {status === "saved" ? "saved" : status === "saving" ? "saving…" : "not saved yet"}</span>
      </div>
      {error && <p role="alert" className="text-sm text-brand">{error}</p>}
      <ol className="space-y-4">
        {questions.map((q, n) => (
          <li key={q.id} className="card">
            <fieldset className="space-y-1.5">
              <legend className="text-sm font-medium">{n + 1}. {q.text}{q.multiple && <span className="font-normal text-muted"> (choose all that apply)</span>}</legend>
              {q.options.map((o, i) => (
                <label key={i} className="flex items-start gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:bg-hover">
                  <input type={q.multiple ? "checkbox" : "radio"} name={q.id} className="mt-0.5" checked={(answers[q.id] ?? []).includes(i)} onChange={(e) => pick(q, i, e.target.checked)} />
                  <span><span className="text-muted">{LETTERS[i]}.</span> {o}</span>
                </label>
              ))}
            </fieldset>
          </li>
        ))}
      </ol>
      <div className="card flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">{answered < questions.length ? `${questions.length - answered} question${questions.length - answered === 1 ? "" : "s"} not answered. An unanswered question counts as wrong.` : "All questions answered."}</p>
        <button type="submit" className="btn" disabled={pending}>{pending ? "Marking…" : "Submit the test"}</button>
      </div>
    </form>
  );
}
