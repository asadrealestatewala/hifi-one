import { PHASE_LABEL, PROJECT_PHASES, type ProjectPhase } from "@/lib/project-updates";

// Shows where a project is in its delivery: finished phases ticked, the current one highlighted, the rest greyed.
export default function PhaseTracker({ phase }: { phase: string | null }) {
  const at = PROJECT_PHASES.indexOf(phase as ProjectPhase);
  return (
    <ol className="grid gap-2 sm:grid-cols-6" aria-label="Project phase">
      {PROJECT_PHASES.map((p, i) => {
        const state = at < 0 ? "todo" : i < at || (p === "LAUNCHED" && i === at) ? "done" : i === at ? "current" : "todo";
        return (
          <li key={p} aria-current={state === "current" ? "step" : undefined} className={`rounded-xl border px-3 py-2 text-xs ${state === "current" ? "border-primary bg-primary/10 font-semibold" : state === "done" ? "border-border bg-hover" : "border-border text-muted"}`}>
            <span className="block text-[11px] text-muted">{state === "done" ? "Done" : state === "current" ? "Now" : `Step ${i + 1}`}</span>
            {PHASE_LABEL[p]}
          </li>
        );
      })}
    </ol>
  );
}
