"use client";
// How long work has been waiting for the project manager, ticking every 30 seconds: amber while inside the response
// time, red once past it. Wall-clock time; the escalation itself counts office minutes (src/lib/task-review.ts).
import { useEffect, useState } from "react";
import { spanText } from "@/lib/task-deadline";

export default function WaitClock({ since, limitMinutes, prefix = "Waiting", className = "" }: { since: string; limitMinutes: number; prefix?: string; className?: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  const ms = Math.max(0, now - new Date(since).getTime());
  const late = ms >= limitMinutes * 60_000;
  return (
    <span suppressHydrationWarning title={`The project manager has ${limitMinutes} office minutes to answer`}
      className={`inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium tabular-nums ${late ? "border-danger bg-danger text-white" : "border-warning/40 bg-warning/10 text-warning"} ${className}`}>
      <span suppressHydrationWarning>{prefix} {spanText(ms)}</span>
    </span>
  );
}
