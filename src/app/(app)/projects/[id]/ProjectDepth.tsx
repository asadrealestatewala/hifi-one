import Link from "next/link";
import { redirect } from "next/navigation";
import { audit, requirePermission, type SessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { ProjectError, addMilestone, assignTaskToMilestone, billMilestone, deleteTime, logTime, projectProfitability, setMemberRate, setMilestoneStatus } from "@/lib/project-finance";
import { projectScope } from "@/lib/projects";

const today = () => new Date().toISOString().slice(0, 10);
const bounce = (id: string, m: string, kind: "error" | "msg" = "error") => redirect(`/projects/${id}?${kind}=${encodeURIComponent(m)}`);

async function inScope(user: SessionUser, projectId: string) {
  const p = await db.project.findFirst({ where: { id: projectId, ...projectScope(user) } });
  if (!p) redirect("/projects");
  return p;
}

async function milestoneAction(formData: FormData) {
  "use server";
  const projectId = String(formData.get("projectId") ?? "");
  const op = String(formData.get("op") ?? "");
  const user = await requirePermission("projects.manage");
  await inScope(user, projectId);
  const org = user.organizationId;
  const s = (k: string) => String(formData.get(k) ?? "");
  try {
    if (op === "add") {
      const m = await addMilestone(db, { organizationId: org, projectId, name: s("name"), dueDate: s("dueDate") || null, amount: s("amount").trim() || null });
      await audit(user, { action: "milestone.create", entity: "Milestone", entityId: m.id, after: { name: m.name } });
    } else if (op === "status") {
      const to = s("to") as "PENDING" | "IN_PROGRESS" | "DONE";
      if (!["PENDING", "IN_PROGRESS", "DONE"].includes(to)) return bounce(projectId, "Unknown status.");
      await setMilestoneStatus(db, { organizationId: org, milestoneId: s("milestoneId"), to });
      await audit(user, { action: "milestone.status", entity: "Milestone", entityId: s("milestoneId"), after: { status: to } });
    } else if (op === "assign") {
      await assignTaskToMilestone(db, { organizationId: org, taskId: s("taskId"), milestoneId: s("milestoneId") || null });
    } else if (op === "bill") {
      await requirePermission("finance.post");
      const r = await billMilestone(db, { organizationId: org, milestoneId: s("milestoneId"), actorId: user.id, taxRate: s("taxRate") || "0" });
      await audit(user, { action: "milestone.bill", entity: "Milestone", entityId: s("milestoneId"), after: { invoiceId: r.invoiceId } });
      redirect(`/finance/invoices/${r.invoiceId}`);
    }
  } catch (e) {
    if (e instanceof ProjectError) return bounce(projectId, e.message);
    throw e;
  }
  redirect(`/projects/${projectId}`);
}

async function timeAction(formData: FormData) {
  "use server";
  const projectId = String(formData.get("projectId") ?? "");
  const op = String(formData.get("op") ?? "");
  const user = await requirePermission("tasks.edit");
  await inScope(user, projectId);
  const s = (k: string) => String(formData.get(k) ?? "");
  try {
    if (op === "log") {
      const e = await logTime(db, { organizationId: user.organizationId, projectId, userId: user.id, taskId: s("taskId") || null, workDate: s("workDate"), hours: s("hours").trim(), note: s("note"), today: today() });
      await audit(user, { action: "time.log", entity: "TimeEntry", entityId: e.id, after: { hours: e.hours.toString(), workDate: e.workDate } });
    } else if (op === "delete") {
      await deleteTime(db, { organizationId: user.organizationId, entryId: s("entryId"), actorId: user.id, isManager: user.permissions.has("projects.manage"), today: today() });
      await audit(user, { action: "time.delete", entity: "TimeEntry", entityId: s("entryId") });
    }
  } catch (e) {
    if (e instanceof ProjectError) return bounce(projectId, e.message);
    throw e;
  }
  redirect(`/projects/${projectId}`);
}

async function rateAction(formData: FormData) {
  "use server";
  const projectId = String(formData.get("projectId") ?? "");
  const user = await requirePermission("projects.costs");
  await requirePermission("projects.manage");
  await inScope(user, projectId);
  try {
    const rate = String(formData.get("hourlyCost") ?? "").trim();
    await setMemberRate(db, { organizationId: user.organizationId, projectId, userId: String(formData.get("userId") ?? ""), hourlyCost: rate || null });
    await audit(user, { action: "project.member_rate", entity: "Project", entityId: projectId, after: { userId: String(formData.get("userId") ?? ""), hourlyCost: rate || null } });
  } catch (e) {
    if (e instanceof ProjectError) return bounce(projectId, e.message);
    throw e;
  }
  redirect(`/projects/${projectId}`);
}

export default async function ProjectDepth({ user, projectId, closed }: { user: SessionUser; projectId: string; closed: boolean }) {
  const org = user.organizationId;
  const canManage = user.permissions.has("projects.manage");
  const canLog = user.permissions.has("tasks.edit") && !closed;
  const canCosts = user.permissions.has("projects.costs");
  const canBill = canManage && user.permissions.has("finance.post");
  const project = await db.project.findFirstOrThrow({ where: { id: projectId, organizationId: org }, include: { members: true, tasks: { select: { id: true, title: true, milestoneId: true, status: true } } } });
  const [milestones, entries, people] = await Promise.all([
    db.milestone.findMany({ where: { projectId }, orderBy: { sortOrder: "asc" } }),
    db.timeEntry.findMany({ where: { projectId }, orderBy: [{ workDate: "desc" }, { createdAt: "desc" }], take: 30 }),
    db.user.findMany({ where: { organizationId: org }, select: { id: true, name: true } }),
  ]);
  const nameOf = new Map(people.map((u) => [u.id, u.name]));
  const fin = canCosts ? await projectProfitability(db, org, projectId) : null;
  // Cost rates are never sent to people without projects.costs; everyone sees hours.
  const myEntries = user.permissions.has("projects.manage") ? entries : entries.filter((e) => e.userId === user.id);
  const cur = project.currency;

  return (
    <>
      <section className="card space-y-3">
        <h2 className="font-semibold">Milestones</h2>
        {milestones.length === 0 && <p className="text-sm text-muted">No milestones yet.</p>}
        <ul className="text-sm space-y-3">
          {milestones.map((m) => {
            const tasks = project.tasks.filter((t) => t.milestoneId === m.id);
            const done = tasks.filter((t) => t.status === "DONE").length;
            return (
              <li key={m.id} className="border-t border-border pt-2 first:border-0 first:pt-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span><strong>{m.name}</strong> <span className="text-muted">· {m.status.toLowerCase().replace("_", " ")}{m.dueDate && ` · due ${m.dueDate}`}{tasks.length > 0 && ` · ${done}/${tasks.length} tasks done`}</span></span>
                  <span>{m.amount && formatMoney(m.amount, cur)}</span>
                </div>
                {m.invoiceId && <p className="text-xs text-muted">Invoiced: <Link className="underline" href={`/finance/invoices/${m.invoiceId}`}>open invoice</Link></p>}
                {canManage && !m.invoiceId && (
                  <div className="flex flex-wrap gap-2 mt-1">
                    {m.status !== "IN_PROGRESS" && m.status !== "DONE" && <form action={milestoneAction}><input type="hidden" name="projectId" value={projectId} /><input type="hidden" name="op" value="status" /><input type="hidden" name="milestoneId" value={m.id} /><input type="hidden" name="to" value="IN_PROGRESS" /><button className="underline text-xs">Start</button></form>}
                    {m.status !== "DONE" && <form action={milestoneAction}><input type="hidden" name="projectId" value={projectId} /><input type="hidden" name="op" value="status" /><input type="hidden" name="milestoneId" value={m.id} /><input type="hidden" name="to" value="DONE" /><button className="underline text-xs">Mark done</button></form>}
                    {m.status === "DONE" && <form action={milestoneAction}><input type="hidden" name="projectId" value={projectId} /><input type="hidden" name="op" value="status" /><input type="hidden" name="milestoneId" value={m.id} /><input type="hidden" name="to" value="IN_PROGRESS" /><button className="underline text-xs">Reopen</button></form>}
                    {m.status === "DONE" && m.amount && canBill && <form action={milestoneAction} className="flex items-center gap-1"><input type="hidden" name="projectId" value={projectId} /><input type="hidden" name="op" value="bill" /><input type="hidden" name="milestoneId" value={m.id} /><input name="taxRate" defaultValue="0" aria-label="Tax rate %" className="input !w-16 !py-0.5 text-xs" /><button className="btn !py-0.5 text-xs">Create draft invoice</button></form>}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        {canManage && !closed && (
          <>
            <form action={milestoneAction} className="grid gap-2 sm:grid-cols-[1fr_9rem_8rem_auto] border-t border-border pt-3">
              <input type="hidden" name="projectId" value={projectId} /><input type="hidden" name="op" value="add" />
              <input name="name" required placeholder="Milestone name" aria-label="Milestone name" className="input" />
              <input name="dueDate" type="date" aria-label="Milestone due date" className="input" />
              <input name="amount" inputMode="decimal" placeholder={`Billing ${cur} (optional)`} aria-label="Billing amount" className="input" disabled={!project.clientId} />
              <button className="btn-ghost">Add</button>
            </form>
            {milestones.some((m) => m.status !== "DONE") && project.tasks.length > 0 && (
              <form action={milestoneAction} className="flex flex-wrap gap-2">
                <input type="hidden" name="projectId" value={projectId} /><input type="hidden" name="op" value="assign" />
                <select name="taskId" required aria-label="Task" className="input w-56"><option value="">Move task…</option>{project.tasks.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}</select>
                <select name="milestoneId" aria-label="Milestone" className="input w-48"><option value="">No milestone</option>{milestones.filter((m) => m.status !== "DONE").map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
                <button className="btn-ghost">Assign</button>
              </form>
            )}
          </>
        )}
      </section>

      <section className="card space-y-3">
        <h2 className="font-semibold">Time</h2>
        {canLog && (
          <form action={timeAction} className="grid gap-2 sm:grid-cols-[9rem_6rem_1fr_1fr_auto]">
            <input type="hidden" name="projectId" value={projectId} /><input type="hidden" name="op" value="log" />
            <input name="workDate" type="date" required defaultValue={today()} max={today()} aria-label="Date worked" className="input" />
            <input name="hours" required inputMode="decimal" placeholder="Hours" aria-label="Hours" className="input" />
            <select name="taskId" aria-label="Task" className="input"><option value="">No specific task</option>{project.tasks.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}</select>
            <input name="note" maxLength={300} placeholder="What did you do?" aria-label="Note" className="input" />
            <button className="btn">Log time</button>
          </form>
        )}
        {myEntries.length === 0 ? <p className="text-sm text-muted">No time logged{canManage ? "" : " by you"} yet.</p> : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted"><tr><th className="py-1 pr-3">Date</th><th className="pr-3">Who</th><th className="pr-3 text-right">Hours</th><th>Note</th><th></th></tr></thead>
            <tbody>
              {myEntries.map((e) => (
                <tr key={e.id} className="border-t border-border">
                  <td className="py-1 pr-3">{e.workDate}</td><td className="pr-3">{nameOf.get(e.userId) ?? "Unknown"}</td><td className="pr-3 text-right">{e.hours.toString()}</td><td>{e.note}</td>
                  <td className="text-right">{(e.userId === user.id || canManage) && !closed && <form action={timeAction}><input type="hidden" name="projectId" value={projectId} /><input type="hidden" name="op" value="delete" /><input type="hidden" name="entryId" value={e.id} /><button className="underline text-xs">Remove</button></form>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {fin && (
        <section className="card space-y-3">
          <h2 className="font-semibold">Financials <span className="text-xs font-normal text-muted">in {fin.currency}, restricted</span></h2>
          <dl className="text-sm grid gap-1 sm:grid-cols-2">
            <div className="flex justify-between"><dt>Revenue (issued invoices, before tax)</dt><dd>{formatMoney(fin.revenue.toString(), fin.currency)}</dd></div>
            <div className="flex justify-between"><dt>Labour ({fin.hours.toString()} h logged)</dt><dd>{formatMoney(fin.labour.toString(), fin.currency)}</dd></div>
            <div className="flex justify-between"><dt>Expenses (posted)</dt><dd>{formatMoney(fin.expenses.toString(), fin.currency)}</dd></div>
            <div className="flex justify-between"><dt>Vendor bills (posted)</dt><dd>{formatMoney(fin.vendor.toString(), fin.currency)}</dd></div>
            <div className="flex justify-between font-semibold border-t border-border pt-1"><dt>Total cost</dt><dd>{formatMoney(fin.cost.toString(), fin.currency)}</dd></div>
            <div className="flex justify-between font-bold border-t border-border pt-1"><dt>Profit{fin.margin !== null && ` (${fin.margin.toString()}% margin)`}</dt><dd>{formatMoney(fin.profit.toString(), fin.currency)}</dd></div>
            <div className="flex justify-between text-muted"><dt>Committed to vendors, not yet billed</dt><dd>{formatMoney(fin.committed.toString(), fin.currency)}</dd></div>
            {fin.budgetUsedPct !== null && <div className="flex justify-between text-muted"><dt>Budget used (cost + commitments)</dt><dd className={fin.budgetUsedPct.gt(100) ? "text-brand font-semibold" : ""}>{fin.budgetUsedPct.toString()}% of {formatMoney(fin.budget!.toString(), fin.currency)}</dd></div>}
          </dl>
          {fin.entriesWithoutRate > 0 && <p className="text-xs text-brand">{fin.entriesWithoutRate} time entr{fin.entriesWithoutRate === 1 ? "y has" : "ies have"} no cost rate, so labour cost is understated. Set rates below; they apply to time logged from then on.</p>}
          {fin.excluded.length > 0 && <p className="text-xs text-muted">Not included (different currency): {fin.excluded.map((x) => `${x.count} in ${x.currency}`).join(", ")}.</p>}
          <details>
            <summary className="text-sm cursor-pointer">Team cost rates ({cur} per hour)</summary>
            <ul className="mt-2 space-y-2 text-sm">
              {project.members.map((m) => (
                <li key={m.userId} className="flex flex-wrap items-center justify-between gap-2">
                  <span>{nameOf.get(m.userId) ?? "Unknown"}</span>
                  {canManage ? (
                    <form action={rateAction} className="flex gap-2">
                      <input type="hidden" name="projectId" value={projectId} /><input type="hidden" name="userId" value={m.userId} />
                      <input name="hourlyCost" inputMode="decimal" defaultValue={m.hourlyCost?.toString() ?? ""} placeholder="Not set" aria-label={`Hourly cost for ${nameOf.get(m.userId)}`} className="input !w-28" />
                      <button className="btn-ghost">Save</button>
                    </form>
                  ) : <span>{m.hourlyCost ? formatMoney(m.hourlyCost, cur) : "Not set"}</span>}
                </li>
              ))}
            </ul>
          </details>
        </section>
      )}
    </>
  );
}
