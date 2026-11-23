"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Notice } from "@/components/ui";
import type { PlanDay, PlanLine, PlanPerson, PlanProject, Skipped } from "@/lib/week-plan";
import { copyLastWeekAction, readPlanSheetAction, saveWeekPlanAction } from "./planner-actions";

type Line = PlanLine & { key: number };

// Plan the week: the project manager writes the team's tasks for the week as rows, fills them from the Excel template or
// from last week, checks them, then adds them all at once. Nothing is saved before "Add tasks"; when a row is wrong nothing
// is saved and the row says what to fix.
export default function WeekPlan({ week, weekText, days, projects, people, startOpen }: {
  week: string; weekText: string; days: PlanDay[]; projects: PlanProject[]; people: PlanPerson[]; startOpen: boolean;
}) {
  const router = useRouter();
  const seq = useRef(0);
  const firstDay = days.find((d) => d.working && !d.past)?.date ?? days.find((d) => !d.past)?.date ?? "";
  const blank = (): Line => ({ key: ++seq.current, personId: "", projectId: projects.length === 1 ? projects[0].id : "", date: firstDay, title: "", priority: "MEDIUM", dueTime: "", hours: "" });
  const [open, setOpen] = useState(startOpen);
  const [lines, setLines] = useState<Line[]>(() => Array.from({ length: 3 }, blank));
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [notes, setNotes] = useState<Skipped[]>([]);
  const [pending, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const name = new Map(people.map((p) => [p.id, p.name]));
  const allPast = days.every((d) => d.past);

  const filled = lines.filter((l) => l.title.trim() || l.personId);
  const set = (key: number, patch: Partial<PlanLine>) => { setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l))); setErrors((e) => { const n = { ...e }; delete n[key]; return n; }); };
  const add = (incoming: PlanLine[]) => {
    const rows = incoming.map((l) => ({ ...l, key: ++seq.current }));
    setLines((ls) => [...ls.filter((l) => l.title.trim() || l.personId), ...rows]);
    setErrors({});
  };

  function upload() {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    const f = new FormData();
    f.set("file", file); f.set("week", week);
    setError(null); setDone(null); setNotes([]);
    start(async () => {
      const r = await readPlanSheetAction(f);
      if (fileRef.current) fileRef.current.value = "";
      if (!r.ok) return setError(r.error);
      add(r.lines); setNotes(r.skipped);
      if (r.lines.length === 0 && r.skipped.length === 0) setError("That file has no task rows under the headings.");
    });
  }
  function copy() {
    setError(null); setDone(null); setNotes([]);
    start(async () => {
      const r = await copyLastWeekAction(week);
      if (!r.ok) return setError(r.error);
      if (r.lines.length === 0) return setError("Last week had no dated, assigned tasks on your projects to copy (repeating tasks and subtasks are left out).");
      add(r.lines);
    });
  }
  function save() {
    setError(null); setDone(null);
    const send = filled;
    if (send.length === 0) return setError("Write at least one task.");
    start(async () => {
      const r = await saveWeekPlanAction(week, send.map((l) => ({ personId: l.personId, projectId: l.projectId, date: l.date, title: l.title, priority: l.priority, dueTime: l.dueTime, hours: l.hours })));
      if (r.ok) {
        setDone(`Added ${r.created} task${r.created === 1 ? "" : "s"} for ${r.people} ${r.people === 1 ? "person" : "people"}. Each of them was told in the bell.`);
        setLines(Array.from({ length: 3 }, blank)); setErrors({}); setNotes([]);
        router.refresh();
        return;
      }
      const byKey: Record<number, string> = {};
      for (const e of r.errors ?? []) { if (e.line >= 0 && send[e.line]) byKey[send[e.line].key] = e.message; else setError(e.message); }
      setErrors(byKey);
      if (r.error) setError(r.error);
      else if (Object.keys(byKey).length) setError(`${Object.keys(byKey).length} row${Object.keys(byKey).length === 1 ? " needs" : "s need"} fixing. Nothing was saved.`);
    });
  }

  if (!open) {
    return (
      <div className="card flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">Plan the week</h2>
          <p className="text-sm text-muted">Write the team&apos;s tasks for {weekText} on one screen, upload them from Excel, or copy last week.</p>
        </div>
        <button type="button" className="btn" onClick={() => setOpen(true)}>Plan the week</button>
      </div>
    );
  }

  return (
    <section className="card space-y-3" aria-labelledby="wp-h">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="wp-h" className="font-semibold">Plan the week of {weekText}</h2>
          <p className="text-sm text-muted">Each row becomes a task with its own deadline. People only see a task on their list from its day, with the rest of the week behind a link.</p>
        </div>
        <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>Close</button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <a className="btn-ghost" href={`/projects/plan-template?week=${week}`} download>Download Excel template</a>
        <label className="btn-ghost cursor-pointer" htmlFor="wp-file">Upload filled template</label>
        <input ref={fileRef} id="wp-file" type="file" accept=".xlsx,.xlsm,.csv" className="sr-only" onChange={upload} disabled={pending} />
        <button type="button" className="btn-ghost" onClick={copy} disabled={pending}>Copy last week</button>
        <button type="button" className="btn-ghost" onClick={() => setLines((ls) => [...ls, blank()])} disabled={pending}>Add row</button>
        {pending && <span className="text-sm text-muted" role="status">Working…</span>}
      </div>
      {allPast && <Notice kind="error">Every day of this week has passed. Go to this week or a later one to plan.</Notice>}
      {error && <Notice kind="error">{error}</Notice>}
      {done && <Notice kind="ok">{done}</Notice>}
      {notes.length > 0 && (
        <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
          <p className="font-medium">Some rows of the file were skipped or changed:</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs">{notes.slice(0, 30).map((n, i) => <li key={i}>Row {n.row}: {n.reason}</li>)}</ul>
          {notes.length > 30 && <p className="mt-1 text-xs">and {notes.length - 30} more.</p>}
        </div>
      )}
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[960px] table-fixed text-sm">
          <colgroup><col className="w-[18%]" /><col className="w-[15%]" /><col className="w-32" /><col /><col className="w-28" /><col className="w-36" /><col className="w-20" /><col className="w-10" /></colgroup>
          <thead className="bg-hover/60 text-left text-xs text-muted">
            <tr className="[&>th]:!static"><th className="px-2 py-2">Project</th><th className="px-2">Person</th><th className="px-2">Day</th><th className="px-2">Task</th><th className="px-2">Priority</th><th className="px-2">Due time</th><th className="px-2">Hours</th><th><span className="sr-only">Remove</span></th></tr>
          </thead>
          <tbody>
            {lines.map((l, i) => {
              const project = projects.find((p) => p.id === l.projectId);
              const team = project ? project.team : people.map((p) => p.id);
              const err = errors[l.key];
              const id = (f: string) => `wp-${l.key}-${f}`;
              return (
                <tr key={l.key} className={`border-t border-border align-top ${err ? "bg-danger/5" : ""}`}>
                  <td className="p-1.5">
                    <label className="sr-only" htmlFor={id("project")}>Project, row {i + 1}</label>
                    <select id={id("project")} className="input !py-1 !text-sm" value={l.projectId} onChange={(e) => set(l.key, { projectId: e.target.value })}>
                      <option value="">Choose…</option>
                      {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </td>
                  <td className="p-1.5">
                    <label className="sr-only" htmlFor={id("person")}>Person, row {i + 1}</label>
                    <select id={id("person")} className="input !py-1 !text-sm" value={l.personId} onChange={(e) => set(l.key, { personId: e.target.value })}>
                      <option value="">Choose…</option>
                      {l.personId && !team.includes(l.personId) && <option value={l.personId}>{name.get(l.personId) ?? "Someone"} (not on this team)</option>}
                      {team.map((pid) => <option key={pid} value={pid}>{name.get(pid) ?? pid}</option>)}
                    </select>
                  </td>
                  <td className="p-1.5">
                    <label className="sr-only" htmlFor={id("day")}>Day, row {i + 1}</label>
                    <select id={id("day")} className="input !py-1 !text-sm" value={l.date} onChange={(e) => set(l.key, { date: e.target.value })}>
                      {days.map((d) => <option key={d.date} value={d.date} disabled={d.past}>{d.label}{!d.working ? " (off)" : ""}</option>)}
                    </select>
                  </td>
                  <td className="p-1.5">
                    <label className="sr-only" htmlFor={id("title")}>Task, row {i + 1}</label>
                    <input id={id("title")} className="input !py-1 !text-sm" value={l.title} maxLength={200} placeholder="What needs doing" onChange={(e) => set(l.key, { title: e.target.value })} />
                    {err && <p className="mt-1 text-xs text-danger" role="alert">{err}</p>}
                  </td>
                  <td className="p-1.5">
                    <label className="sr-only" htmlFor={id("priority")}>Priority, row {i + 1}</label>
                    <select id={id("priority")} className="input !py-1 !text-sm" value={l.priority} onChange={(e) => set(l.key, { priority: e.target.value })}>
                      <option value="LOW">Low</option><option value="MEDIUM">Medium</option><option value="HIGH">High</option>
                    </select>
                  </td>
                  <td className="p-1.5">
                    <label className="sr-only" htmlFor={id("time")}>Due time, row {i + 1}</label>
                    <input id={id("time")} type="time" className="input !py-1 !text-sm" value={l.dueTime} onChange={(e) => set(l.key, { dueTime: e.target.value })} />
                  </td>
                  <td className="p-1.5">
                    <label className="sr-only" htmlFor={id("hours")}>Hours, row {i + 1}</label>
                    <input id={id("hours")} inputMode="decimal" className="input !py-1 !text-sm" value={l.hours} placeholder="–" onChange={(e) => set(l.key, { hours: e.target.value })} />
                  </td>
                  <td className="p-1.5 text-center">
                    <button type="button" className="rounded px-1.5 py-1 text-muted hover:bg-hover hover:text-danger" aria-label={`Remove row ${i + 1}`} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>×</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted">Empty due time means the end of the office day. Only the people on a project&apos;s team are offered for it.</p>
        <button type="button" className="btn" onClick={save} disabled={pending || filled.length === 0 || allPast}>{pending ? "Saving…" : filled.length ? `Add ${filled.length} task${filled.length === 1 ? "" : "s"}` : "Add tasks"}</button>
      </div>
    </section>
  );
}
