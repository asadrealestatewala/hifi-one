"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import type { RunningTimer } from "@/lib/task-timer";
import { discardTimerAction, stopTimerAction } from "@/app/(app)/projects/timer-actions";
import ConfirmButton from "@/components/ui/ConfirmButton";

export const TIMER_EVENT = "hifi:timer"; // detail: RunningTimer | null, sent by whatever starts or stops a timer
const LONG_HOURS = 10;

const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

// The running task timer, on every screen while it runs: the task, the time so far, and Stop. Stop opens a short form with the
// measured hours (editable) and a note; saving puts the time in the project's time log. A timer that ran very long asks for the
// hours to be typed in, so a forgotten timer never logs a whole night.
export default function TaskTimerDock({ initial }: { initial: RunningTimer | null }) {
  const router = useRouter();
  const [timer, setTimer] = useState(initial);
  const [now, setNow] = useState<number | null>(null); // set after mounting, so the server and browser render the same text
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    const on = (e: Event) => { const t = (e as CustomEvent<RunningTimer | null>).detail; setTimer(t); setOpen(false); setError(null); if (t) setDone(null); };
    window.addEventListener(TIMER_EVENT, on);
    return () => window.removeEventListener(TIMER_EVENT, on);
  }, []);
  useEffect(() => {
    if (!timer) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [timer]);
  useEffect(() => { if (!done) return; const id = setTimeout(() => setDone(null), 5000); return () => clearTimeout(id); }, [done]);

  if (!timer) return done ? <p role="status" className="mx-4 mt-3 rounded-lg bg-success/10 px-3 py-2 text-sm text-success md:mx-8 print:hidden">{done}</p> : null;
  const ms = now === null ? 0 : now - Date.parse(timer.startedAt);
  const measured = Math.max(1, Math.round(ms / 60_000)) / 60;
  const long = measured > LONG_HOURS;
  const finish = (r: Awaited<ReturnType<typeof stopTimerAction>>) => {
    if (!r.ok) { setError(r.error); return; }
    setTimer(null); setOpen(false); setError(null); setDone(r.message ?? null);
    window.dispatchEvent(new CustomEvent(TIMER_EVENT, { detail: null }));
    router.refresh();
  };

  return (
    <div className="mx-4 mt-3 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2 text-sm md:mx-8 print:hidden" role="region" aria-label="Task timer">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="inline-flex h-2 w-2 animate-pulse rounded-full bg-brand motion-reduce:animate-none" aria-hidden />
        <span className="font-mono font-semibold tabular-nums" aria-live="off">{now === null ? "–:––:––" : clock(ms)}</span>
        <Link href={`/projects/${timer.projectId}?task=${timer.taskId}`} className="min-w-0 flex-1 truncate hover:underline" title={`${timer.task} · ${timer.project}`}>
          {timer.task}<span className="text-muted"> · {timer.project}</span>
        </Link>
        {!open && <button type="button" className="btn !py-1" onClick={() => setOpen(true)}>Stop</button>}
      </div>
      {open && (
        <form className="mt-2 flex flex-wrap items-end gap-2" onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          start(async () => finish(await stopTimerAction(String(f.get("hours") ?? "") || null, String(f.get("note") ?? "") || null)));
        }}>
          <div>
            <label className="label" htmlFor="tt-h">Hours</label>
            <input id="tt-h" name="hours" inputMode="decimal" required={long} defaultValue={long ? "" : measured.toFixed(2)} placeholder={long ? "e.g. 3.5" : undefined} className="input !w-24" />
          </div>
          <div className="min-w-48 flex-1">
            <label className="label" htmlFor="tt-n">Note (optional)</label>
            <input id="tt-n" name="note" maxLength={300} defaultValue={timer.note ?? ""} className="input" />
          </div>
          <button className="btn" disabled={pending}>{pending ? "Saving…" : "Save to time log"}</button>
          <button type="button" className="btn-ghost" onClick={() => { setOpen(false); setError(null); }}>Keep running</button>
          {long && <p className="w-full text-xs text-warning">This timer has run for over {LONG_HOURS} hours. Type the hours you actually worked.</p>}
          {error && <p role="alert" className="w-full text-xs text-brand">{error}</p>}
        </form>
      )}
      {open && (
        <form className="mt-1" onSubmit={(e) => { e.preventDefault(); start(async () => finish(await discardTimerAction())); }}>
          <ConfirmButton title="Discard this timer?" message="The time it measured is not saved anywhere." confirmLabel="Discard timer" className="text-xs text-brand hover:underline">Discard without saving</ConfirmButton>
        </form>
      )}
    </div>
  );
}
