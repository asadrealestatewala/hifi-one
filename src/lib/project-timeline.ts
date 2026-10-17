// A project's timeline: each task is a bar from the day it was created to its due date (or, once done, the day it was completed).
// Tasks with no due date are listed apart, never given an invented date. Pure and tested; the page only draws what this returns.
export type TimelineTask = { id: string; title: string; status: string; createdAt: Date; dueDate: Date | null; completedAt: Date | null; assignee?: string | null };
export type Bar = { id: string; title: string; status: string; assignee: string | null; start: string; end: string; left: number; width: number; overdue: boolean; done: boolean };
export type Timeline = {
  from: string; to: string; days: number; todayPct: number | null;
  bars: Bar[]; undated: { id: string; title: string; status: string }[];
  markers: { label: string; date: string; left: number }[]; weeks: { label: string; left: number }[];
};

const DAY = 86_400_000;
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const midnight = (s: string) => Date.parse(`${s}T00:00:00Z`);

export function buildTimeline(p: { tasks: TimelineTask[]; today: string; projectStart?: Date | null; deadline?: Date | null; milestones?: { name: string; dueDate: string | null }[] }): Timeline {
  const rows = p.tasks.filter((t) => t.dueDate || (t.status === "DONE" && t.completedAt));
  const undated = p.tasks.filter((t) => !rows.includes(t)).map((t) => ({ id: t.id, title: t.title, status: t.status }));
  const spans = rows.map((t) => {
    const end = ymd(t.status === "DONE" && t.completedAt ? t.completedAt : t.dueDate!);
    const rawStart = ymd(t.createdAt);
    return { t, start: rawStart > end ? end : rawStart, end };
  });
  const points = [...spans.flatMap((s) => [s.start, s.end]), ...(p.projectStart ? [ymd(p.projectStart)] : []), ...(p.deadline ? [ymd(p.deadline)] : []), p.today];
  const from = points.reduce((a, b) => (a < b ? a : b));
  const to = points.reduce((a, b) => (a > b ? a : b));
  const days = Math.round((midnight(to) - midnight(from)) / DAY) + 1;
  const pos = (d: string) => ((midnight(d) - midnight(from)) / DAY / days) * 100;
  const bars = spans
    .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : a.t.id < b.t.id ? -1 : 1))
    .map(({ t, start, end }) => ({
      id: t.id, title: t.title, status: t.status, assignee: t.assignee ?? null, start, end,
      left: pos(start), width: Math.max(((midnight(end) - midnight(start)) / DAY + 1) / days * 100, 1.2),
      done: t.status === "DONE", overdue: t.status !== "DONE" && end < p.today,
    }));
  const markers = [
    ...(p.deadline ? [{ label: "Deadline", date: ymd(p.deadline), left: pos(ymd(p.deadline)) }] : []),
    ...(p.milestones ?? []).flatMap((m) => (m.dueDate ? [{ label: m.name, date: m.dueDate, left: Math.min(Math.max(pos(m.dueDate), 0), 100) }] : [])),
  ];
  const weeks: Timeline["weeks"] = [];
  for (let i = 0; i < days; i += Math.max(7, Math.ceil(days / 10 / 7) * 7)) weeks.push({ label: ymd(new Date(midnight(from) + i * DAY)).slice(5), left: (i / days) * 100 });
  return { from, to, days, todayPct: p.today >= from && p.today <= to ? pos(p.today) : null, bars, undated, markers, weeks };
}
