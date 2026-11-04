import type { Point } from "@/lib/clout-rules";

// A small line chart drawn on the server from saved snapshots. One chart per metric, each with its own scale, so a few
// likes are not flattened by millions of views. Colours come from the theme tokens; the table below the chart carries the same numbers.
const W = 640, H = 140, PAD = { l: 8, r: 8, t: 10, b: 20 };
const compact = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}K` : String(n));
const day = (d: Date) => d.toISOString().slice(5, 16).replace("T", " ");

export default function GrowthChart({ title, points, pick, tone }: { title: string; points: Point[]; pick: (p: Point) => number; tone: string }) {
  if (points.length < 2) return (
    <div className="rounded-lg border border-border p-4"><p className="text-sm font-medium">{title}</p><p className="mt-1 text-xs text-muted">The chart needs at least two checks. It fills in as the post is refreshed.</p></div>
  );
  const vals = points.map(pick);
  const min = Math.min(...vals), max = Math.max(...vals);
  const span = max - min || 1;
  const t0 = points[0].takenAt.getTime(), t1 = points[points.length - 1].takenAt.getTime();
  const x = (p: Point) => PAD.l + ((p.takenAt.getTime() - t0) / Math.max(1, t1 - t0)) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + (1 - (v - min) / span) * (H - PAD.t - PAD.b);
  const d = points.map((p, i) => `${i ? "L" : "M"}${x(p).toFixed(1)},${y(pick(p)).toFixed(1)}`).join(" ");
  const last = points[points.length - 1];
  return (
    <figure className="rounded-lg border border-border p-4">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-2 text-sm"><span className="font-medium">{title}</span><span className="text-xs text-muted">{compact(min)} to {compact(max)}</span></figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className={`mt-2 h-36 w-full ${tone}`} role="img" aria-label={`${title}: from ${min.toLocaleString("en-US")} to ${max.toLocaleString("en-US")} between ${day(points[0].takenAt)} and ${day(last.takenAt)} UTC`}>
        <line x1={PAD.l} x2={W - PAD.r} y1={H - PAD.b} y2={H - PAD.b} stroke="currentColor" strokeOpacity="0.2" />
        <path d={d} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={x(last)} cy={y(pick(last))} r="3.5" fill="currentColor" />
        <text x={PAD.l} y={H - 4} fontSize="10" fill="currentColor" fillOpacity="0.6">{day(points[0].takenAt)}</text>
        <text x={W - PAD.r} y={H - 4} fontSize="10" textAnchor="end" fill="currentColor" fillOpacity="0.6">{day(last.takenAt)} UTC</text>
      </svg>
    </figure>
  );
}
