"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { TemplateBody } from "@/lib/project-templates";
import { saveTemplateAction } from "../../template-actions";

type Task = { title: string; description: string; day: string; hours: string; priority: string; role: string; milestone: string; clientVisible: boolean; repeat: string; labels: string; subtasks: string; checklist: string };
type Milestone = { name: string; day: string };
const blankTask = (): Task => ({ title: "", description: "", day: "", hours: "", priority: "MEDIUM", role: "", milestone: "", clientVisible: false, repeat: "", labels: "", subtasks: "", checklist: "" });
const num = (v: number | undefined) => (v === undefined ? "" : String(v));

// Edits a template as plain rows. Due dates are days after the project start (0 = the start day), so one plan fits any start.
export default function TemplateEditor({ initial }: { initial: { id?: string; name: string; description: string; body: TemplateBody } }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [roles, setRoles] = useState<string[]>(initial.body.roles);
  const [newRole, setNewRole] = useState("");
  const [milestones, setMilestones] = useState<Milestone[]>(initial.body.milestones.map((m) => ({ name: m.name, day: num(m.day) })));
  const [tasks, setTasks] = useState<Task[]>(initial.body.tasks.map((t) => ({
    title: t.title, description: t.description, day: num(t.day), hours: num(t.hours), priority: t.priority, role: t.role, milestone: t.milestone,
    clientVisible: t.clientVisible, repeat: t.repeat ?? "", labels: t.labels.join(", "), subtasks: t.subtasks.join("\n"), checklist: t.checklist.join("\n"),
  })));

  const setTask = (i: number, over: Partial<Task>) => setTasks((ts) => ts.map((t, j) => (j === i ? { ...t, ...over } : t)));
  const move = (i: number, d: number) => setTasks((ts) => { const n = [...ts]; const j = i + d; if (j < 0 || j >= n.length) return ts; [n[i], n[j]] = [n[j], n[i]]; return n; });
  const addRole = () => { const r = newRole.trim(); if (r && !roles.some((x) => x.toLowerCase() === r.toLowerCase())) setRoles([...roles, r]); setNewRole(""); };
  const removeRole = (r: string) => { setRoles(roles.filter((x) => x !== r)); setTasks((ts) => ts.map((t) => (t.role === r ? { ...t, role: "" } : t))); };
  const renameMilestone = (i: number, value: string) => {
    const old = milestones[i].name;
    setMilestones(milestones.map((m, j) => (j === i ? { ...m, name: value } : m)));
    setTasks((ts) => ts.map((t) => (old && t.milestone === old ? { ...t, milestone: value } : t)));
  };
  const removeMilestone = (i: number) => { const old = milestones[i].name; setMilestones(milestones.filter((_, j) => j !== i)); setTasks((ts) => ts.map((t) => (t.milestone === old ? { ...t, milestone: "" } : t))); };

  const save = () => start(async () => {
    setError("");
    const body = {
      roles,
      milestones: milestones.filter((m) => m.name.trim()).map((m) => ({ name: m.name.trim(), ...(m.day.trim() ? { day: m.day.trim() } : {}) })),
      tasks: tasks.filter((t) => t.title.trim()).map((t) => ({
        title: t.title.trim(), description: t.description, priority: t.priority, role: t.role, milestone: t.milestone.trim(), clientVisible: t.clientVisible,
        ...(t.day.trim() ? { day: t.day.trim() } : {}), ...(t.hours.trim() ? { hours: t.hours.trim().replace(",", ".") } : {}), ...(t.repeat ? { repeat: t.repeat } : {}),
        labels: t.labels.split(",").map((l) => l.trim()).filter(Boolean), subtasks: t.subtasks.split("\n").map((l) => l.trim()).filter(Boolean),
        checklist: t.checklist.split("\n").map((l) => l.trim()).filter(Boolean),
      })),
    };
    const r = await saveTemplateAction({ id: initial.id, name, description, body });
    if (!r.ok) { setError(r.error); return; }
    router.push(`/projects/templates/${r.id}?saved=1`);
    router.refresh();
  });

  const names = milestones.map((m) => m.name.trim()).filter(Boolean);
  return (
    <form onSubmit={(e) => { e.preventDefault(); save(); }} className="space-y-5 text-sm">
      {error && <p role="alert" className="rounded-lg bg-brand/10 px-3 py-2 text-brand">{error}</p>}
      <section className="card grid gap-3 sm:grid-cols-2">
        <div><label className="label" htmlFor="tpl-name">Template name</label><input id="tpl-name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} className="input" /></div>
        <div><label className="label" htmlFor="tpl-desc">What it is for</label><input id="tpl-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} className="input" /></div>
      </section>

      <section className="card space-y-3">
        <div><h2 className="font-semibold">Team roles</h2><p className="text-xs text-muted">When a project starts from this template, you pick a person for each role and their tasks go to them.</p></div>
        <div className="flex flex-wrap gap-2">
          {roles.length === 0 && <span className="text-muted">No roles yet.</span>}
          {roles.map((r) => <span key={r} className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1">{r}<button type="button" aria-label={`Remove role ${r}`} onClick={() => removeRole(r)} className="text-muted hover:text-brand">×</button></span>)}
        </div>
        <div className="flex gap-2"><input value={newRole} onChange={(e) => setNewRole(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addRole(); } }} maxLength={60} placeholder="e.g. Graphic designer" aria-label="New role" className="input max-w-xs" /><button type="button" className="btn-ghost" onClick={addRole} disabled={!newRole.trim() || roles.length >= 12}>Add role</button></div>
      </section>

      <section className="card space-y-3">
        <div><h2 className="font-semibold">Milestones</h2><p className="text-xs text-muted">Due day counts from the project start: 0 is the start day, 30 is a month later.</p></div>
        {milestones.length === 0 && <p className="text-muted">No milestones yet.</p>}
        {milestones.map((m, i) => (
          <div key={i} className="flex flex-wrap items-end gap-2">
            <div className="min-w-0 flex-1"><label className="label" htmlFor={`ms-${i}`}>Milestone</label><input id={`ms-${i}`} value={m.name} onChange={(e) => renameMilestone(i, e.target.value)} maxLength={120} className="input" /></div>
            <div className="w-24"><label className="label" htmlFor={`msd-${i}`}>Due day</label><input id={`msd-${i}`} value={m.day} onChange={(e) => setMilestones(milestones.map((x, j) => (j === i ? { ...x, day: e.target.value } : x)))} inputMode="numeric" className="input" /></div>
            <button type="button" className="btn-ghost" onClick={() => removeMilestone(i)} aria-label={`Remove milestone ${m.name || i + 1}`}>Remove</button>
          </div>
        ))}
        <button type="button" className="btn-ghost" onClick={() => setMilestones([...milestones, { name: "", day: "" }])} disabled={milestones.length >= 20}>Add milestone</button>
      </section>

      <section className="card space-y-3">
        <div><h2 className="font-semibold">Tasks <span className="text-xs font-normal text-muted">{tasks.length} of 150</span></h2><p className="text-xs text-muted">Rows without a title are left out when you save.</p></div>
        {tasks.length === 0 && <p className="text-muted">No tasks yet.</p>}
        <ol className="space-y-3">
          {tasks.map((t, i) => (
            <li key={i} className="space-y-2 rounded-xl border border-border p-3">
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-0 flex-[2_1_14rem]"><label className="label" htmlFor={`t-${i}`}>Task {i + 1}</label><input id={`t-${i}`} value={t.title} onChange={(e) => setTask(i, { title: e.target.value })} maxLength={200} className="input" /></div>
                <div className="w-20"><label className="label" htmlFor={`td-${i}`}>Due day</label><input id={`td-${i}`} value={t.day} onChange={(e) => setTask(i, { day: e.target.value })} inputMode="numeric" className="input" /></div>
                <div className="w-20"><label className="label" htmlFor={`th-${i}`}>Hours</label><input id={`th-${i}`} value={t.hours} onChange={(e) => setTask(i, { hours: e.target.value })} inputMode="decimal" className="input" /></div>
                <div className="w-28"><label className="label" htmlFor={`tp-${i}`}>Priority</label><select id={`tp-${i}`} value={t.priority} onChange={(e) => setTask(i, { priority: e.target.value })} className="input">{["LOW", "MEDIUM", "HIGH"].map((p) => <option key={p}>{p}</option>)}</select></div>
                <div className="min-w-0 flex-[1_1_10rem]"><label className="label" htmlFor={`tr-${i}`}>Role</label><select id={`tr-${i}`} value={t.role} onChange={(e) => setTask(i, { role: e.target.value })} className="input"><option value="">Unassigned</option>{roles.map((r) => <option key={r}>{r}</option>)}</select></div>
                <div className="min-w-0 flex-[1_1_10rem]"><label className="label" htmlFor={`tm-${i}`}>Milestone</label><select id={`tm-${i}`} value={t.milestone} onChange={(e) => setTask(i, { milestone: e.target.value })} className="input"><option value="">None</option>{names.map((n) => <option key={n}>{n}</option>)}</select></div>
              </div>
              <details className="text-sm">
                <summary className="cursor-pointer text-xs text-muted">More: description, checklist, subtasks, labels, repeat, client view{(t.checklist.trim() || t.subtasks.trim()) ? " ·" : ""}{t.checklist.trim() ? ` ${t.checklist.split("\n").filter((l) => l.trim()).length} checklist items` : ""}{t.subtasks.trim() ? ` ${t.subtasks.split("\n").filter((l) => l.trim()).length} subtasks` : ""}</summary>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <div className="sm:col-span-2"><label className="label" htmlFor={`tde-${i}`}>Description</label><textarea id={`tde-${i}`} value={t.description} onChange={(e) => setTask(i, { description: e.target.value })} rows={2} maxLength={2000} className="input" /></div>
                  <div><label className="label" htmlFor={`tc-${i}`}>Checklist (one item per line)</label><textarea id={`tc-${i}`} value={t.checklist} onChange={(e) => setTask(i, { checklist: e.target.value })} rows={3} placeholder="Spelling checked" className="input" /></div>
                  <div><label className="label" htmlFor={`ts-${i}`}>Subtasks (one per line)</label><textarea id={`ts-${i}`} value={t.subtasks} onChange={(e) => setTask(i, { subtasks: e.target.value })} rows={3} className="input" /></div>
                  <div className="space-y-2">
                    <div><label className="label" htmlFor={`tl-${i}`}>Labels (comma separated)</label><input id={`tl-${i}`} value={t.labels} onChange={(e) => setTask(i, { labels: e.target.value })} placeholder="Copy, Design" className="input" /></div>
                    <div><label className="label" htmlFor={`tre-${i}`}>Repeats</label><select id={`tre-${i}`} value={t.repeat} onChange={(e) => setTask(i, { repeat: e.target.value })} className="input"><option value="">Does not repeat</option><option value="DAILY">Daily</option><option value="WEEKLY">Weekly</option><option value="MONTHLY">Monthly</option></select></div>
                    <label className="flex items-center gap-2"><input type="checkbox" checked={t.clientVisible} onChange={(e) => setTask(i, { clientVisible: e.target.checked })} /> Visible to the client</label>
                  </div>
                </div>
              </details>
              <div className="flex justify-end gap-2">
                <button type="button" className="btn-ghost" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move task ${i + 1} up`}>↑</button>
                <button type="button" className="btn-ghost" onClick={() => move(i, 1)} disabled={i === tasks.length - 1} aria-label={`Move task ${i + 1} down`}>↓</button>
                <button type="button" className="btn-ghost" onClick={() => setTasks(tasks.filter((_, j) => j !== i))}>Remove</button>
              </div>
            </li>
          ))}
        </ol>
        <button type="button" className="btn-ghost" onClick={() => setTasks([...tasks, blankTask()])} disabled={tasks.length >= 150}>Add task</button>
      </section>

      <div className="flex justify-end"><button className="btn" disabled={pending}>{pending ? "Saving…" : "Save template"}</button></div>
    </form>
  );
}
