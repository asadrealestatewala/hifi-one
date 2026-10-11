import Icon from "@/components/shell/Icon";

type Goal = { id: string; label: string; value: number; target: number; detail?: string };
type Badge = { id: string; label: string; earned: boolean };

function Ring({ pct, children, color }: { pct: number; children: React.ReactNode; color: string }) {
  const r = 22, c = 2 * Math.PI * r;
  return (
    <div className="relative h-14 w-14 shrink-0">
      <svg viewBox="0 0 56 56" className="h-14 w-14 -rotate-90" aria-hidden="true"><circle cx="28" cy="28" r={r} fill="none" stroke="var(--hover)" strokeWidth="6" /><circle cx="28" cy="28" r={r} fill="none" stroke={color} strokeWidth="6" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - Math.min(1, pct))} className="transition-all duration-700" /></svg>
      <span className="absolute inset-0 flex items-center justify-center text-[11px] font-semibold">{children}</span>
    </div>
  );
}

// Today's goals, level and streak. Rings fill as you work; finish all three and the card celebrates.
export default function QuestCard({ name, goals, xp, level, levelName, levelStartsAt, nextLevelAt, streak, badges, allDone }: {
  name: string; goals: Goal[]; xp: number; level: number; levelName: string; levelStartsAt: number; nextLevelAt: number | null; streak: number; badges: Badge[]; allDone: boolean;
}) {
  const span = nextLevelAt ? nextLevelAt - levelStartsAt : 1;
  const into = nextLevelAt ? Math.min(1, (xp - levelStartsAt) / span) : 1;
  return (
    <section className="card relative overflow-hidden !p-0" aria-label="Your daily goals">
      {allDone && <div className="confetti pointer-events-none absolute inset-x-0 top-0 h-full" aria-hidden="true">{Array.from({ length: 18 }).map((_, i) => <i key={i} style={{ left: `${(i * 5.6 + 3) % 100}%`, background: ["#5648e8", "#f97316", "#059669", "#e11d74", "#0ea5e9"][i % 5], animationDelay: `${(i % 6) * 0.12}s` }} />)}</div>}
      <div className="grid gap-5 bg-gradient-to-br from-primary/10 via-transparent to-accent/10 p-5 lg:grid-cols-[1.1fr_1.6fr_1fr]">
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted">{allDone ? "All goals done today. Brilliant!" : `Keep going, ${name.split(" ")[0]}`}</p>
          <div className="flex items-center gap-3">
            <span className="pop flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-accent text-lg font-bold text-white shadow-md">{level}</span>
            <div><p className="text-base font-semibold leading-tight">{levelName}</p><p className="text-xs text-muted">{xp} XP{nextLevelAt ? ` · ${nextLevelAt - xp} to level ${level + 1}` : " · top level"}</p></div>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-hover" role="progressbar" aria-valuenow={Math.round(into * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Progress to next level"><div className="h-full rounded-full bg-gradient-to-r from-primary to-accent transition-all duration-700" style={{ width: `${into * 100}%` }} /></div>
        </div>
        <ul className="grid grid-cols-3 gap-3">
          {goals.map((g) => {
            const done = g.value >= g.target;
            return (
              <li key={g.id} className="flex flex-col items-center gap-1.5 text-center">
                <Ring pct={g.value / g.target} color={done ? "var(--success)" : "var(--primary)"}>{done ? <Icon name="check" className="h-5 w-5 text-success" /> : `${g.value}/${g.target}`}</Ring>
                <span className="text-[11px] font-medium leading-tight">{g.label}</span>
                {g.detail && <span className="text-[10px] text-muted">{g.detail}</span>}
              </li>
            );
          })}
        </ul>
        <div className="space-y-2">
          <p className="flex items-center gap-1.5 text-sm font-semibold"><span aria-hidden>🔥</span>{streak} day{streak === 1 ? "" : "s"} streak</p>
          <ul className="flex flex-wrap gap-1.5">{badges.map((b) => <li key={b.id} title={b.earned ? `Earned: ${b.label}` : `Locked: ${b.label}`} className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${b.earned ? "bg-warning/15 text-warning" : "bg-hover text-muted opacity-60"}`}>{b.earned ? "★ " : "☆ "}{b.label}</li>)}</ul>
        </div>
      </div>
    </section>
  );
}
