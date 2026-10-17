import Link from "next/link";
import { buildTimeline, type TimelineTask } from "@/lib/project-timeline";

const MAX_ROWS = 40;

// Gantt-style view of the project's tasks: one bar per task from creation to due date, today's line, milestones and the deadline.
// Colour is never the only signal: every bar also carries its dates in text.
export default function ProjectTimeline({ projectId, tasks, today, projectStart, deadline, milestones }: {
  projectId: string; tasks: (TimelineTask & { assignee?: string | null })[]; today: string; projectStart: Date | null; deadline: Date | null; milestones: { name: string; dueDate: string | null }[];
}) {
  const t = buildTimeline({ tasks, today, projectStart, deadline, milestones });
  if (t.bars.length === 0 && t.undated.length === 0) return null;
  const shown = t.bars.slice(0, MAX_ROWS);
  return (
    <section className="card space-y-3" aria-labelledby="timeline-h">
      <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 id="timeline-h" className="font-semibold">Timeline</h2><span className="text-xs text-muted">{t.from} to {t.to}</span></div>
      {shown.length === 0 ? <p className="text-sm text-muted">No task has a due date yet, so there is nothing to draw. Set due dates on the tasks below.</p> : (
        <div className="overflow-x-auto">
          <div className="min-w-[640px]">
            <div className="relative ml-44 h-5 text-[10px] text-muted">
              {t.weeks.map((w) => <span key={w.label} className="absolute" style={{ left: `${w.left}%` }}>{w.label}</span>)}
            </div>
            <ul className="space-y-1">
              {shown.map((b) => (
                <li key={b.id} className="flex items-center gap-2">
                  <Link href={`/projects/${projectId}?task=${b.id}`} className="w-44 shrink-0 truncate text-xs hover:underline" title={b.title}>{b.title}</Link>
                  <div className="relative h-5 flex-1 rounded bg-hover/60">
                    {t.todayPct !== null && <span aria-hidden className="absolute inset-y-0 w-px bg-brand/60" style={{ left: `${t.todayPct}%` }} />}
                    <span className={`absolute inset-y-0.5 rounded px-1 text-[10px] leading-4 text-white ${b.done ? "bg-success" : b.overdue ? "bg-brand" : "bg-primary"}`} style={{ left: `${b.left}%`, width: `${b.width}%` }}
                      title={`${b.title}: ${b.start} to ${b.end}${b.assignee ? `, ${b.assignee}` : ""}${b.overdue ? ", overdue" : b.done ? ", done" : ""}`}>
                      <span className="sr-only">{b.title}, {b.start} to {b.end}{b.overdue ? ", overdue" : b.done ? ", done" : ""}</span>
                    </span>
                  </div>
                </li>
              ))}
            </ul>
            {t.markers.length > 0 && (
              <div className="relative ml-44 mt-2 h-4 text-[10px] text-muted">
                {t.markers.map((m) => <span key={m.label + m.date} className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: `${m.left}%` }}>◆ {m.label} {m.date.slice(5)}</span>)}
              </div>
            )}
          </div>
        </div>
      )}
      <p className="text-xs text-muted">{t.bars.length > MAX_ROWS ? `Showing the first ${MAX_ROWS} of ${t.bars.length} dated tasks. ` : ""}Bars run from the day a task was created to its due date (to the completion day once done). <span className="text-brand">Red</span> is overdue, <span className="text-success">green</span> is done. The thin line is today.</p>
      {t.undated.length > 0 && <p className="text-xs text-muted">No due date: {t.undated.slice(0, 8).map((u) => u.title).join(", ")}{t.undated.length > 8 ? ` and ${t.undated.length - 8} more` : ""}.</p>}
    </section>
  );
}
