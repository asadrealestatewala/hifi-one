"use client";
// The live time left on a task: green, orange in the last two hours or last quarter, red in the last half hour, and a
// solid "Overdue 1 h 05 m" after. Rules in src/lib/task-deadline.ts. Ticks every 30 seconds; a finished task shows
// whether it made its deadline instead.
import { useEffect, useState } from "react";
import { countdown, finishedText, type CountdownTone } from "@/lib/task-deadline";

const TONE: Record<CountdownTone, string> = {
  green: "border-success/30 bg-success/10 text-success",
  orange: "border-warning/40 bg-warning/10 text-warning",
  red: "border-danger/40 bg-danger/10 text-danger",
  overdue: "border-danger bg-danger text-white",
};

export default function TaskCountdown({ deadline, from, completedAt, title, className = "" }: {
  deadline: string; // ISO instant
  from?: string | null; // when the person got the task
  completedAt?: string | null; // set when the task is done
  title?: string; // the deadline in words, for the tooltip and screen readers
  className?: string;
}) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (completedAt) return;
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, [completedAt]);
  const at = new Date(deadline);
  const base = `inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium tabular-nums ${className}`;
  if (completedAt) {
    const f = finishedText(at, new Date(completedAt));
    return <span className={`${base} ${f.onTime ? "border-border text-muted" : "border-danger/30 text-danger"}`} title={title}>{f.text}</span>;
  }
  const c = countdown(at, now, from ? new Date(from) : null);
  return (
    <span className={`${base} ${TONE[c.tone]}`} title={title ? `Due ${title}` : undefined} suppressHydrationWarning>
      <span suppressHydrationWarning>{c.text}</span>
      {title && <span className="sr-only">, due {title}</span>}
    </span>
  );
}
