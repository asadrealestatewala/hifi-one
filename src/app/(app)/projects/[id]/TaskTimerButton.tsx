"use client";

import { useEffect, useState, useTransition } from "react";
import type { RunningTimer } from "@/lib/task-timer";
import { TIMER_EVENT } from "@/components/shell/TaskTimerDock";
import { startTimerAction } from "../timer-actions";

// Start a timer on this task. While it runs, the bar at the top of every screen shows it with Stop, which saves the time to the log.
export default function TaskTimerButton({ taskId, runningTaskId }: { taskId: string; runningTaskId: string | null }) {
  const [running, setRunning] = useState(runningTaskId);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  useEffect(() => {
    const on = (e: Event) => setRunning((e as CustomEvent<RunningTimer | null>).detail?.taskId ?? null);
    window.addEventListener(TIMER_EVENT, on);
    return () => window.removeEventListener(TIMER_EVENT, on);
  }, []);
  if (running === taskId) return <p className="text-xs text-primary">The timer is running on this task. Stop it from the bar at the top of the screen.</p>;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className="btn-ghost !py-1" disabled={pending} onClick={() => start(async () => {
        const r = await startTimerAction(taskId);
        if (!r.ok) { setError(r.error); return; }
        setError(null);
        window.dispatchEvent(new CustomEvent(TIMER_EVENT, { detail: r.timer }));
      })}>{pending ? "Starting…" : "▶ Start timer"}</button>
      {error && <span role="alert" className="text-xs text-brand">{error}</span>}
    </div>
  );
}
