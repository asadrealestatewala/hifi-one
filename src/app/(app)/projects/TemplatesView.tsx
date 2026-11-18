import Link from "next/link";
import type { SessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { parseTemplateBody, STARTER_TEMPLATES } from "@/lib/project-templates";
import { Badge, Chips, Empty, NewButton, Notice, PageHeader } from "@/components/ui";
import SubmitButton from "@/components/ui/SubmitButton";
import ConfirmButton from "@/components/ui/ConfirmButton";
import { addStarterTemplatesAction, archiveTemplateAction } from "./template-actions";
import { deleteSavedChecklistAction } from "./checklist-actions";
import { listSavedChecklists } from "@/lib/task-checklists";

// Projects → Templates: reusable plans (roles, milestones, tasks) that New project can start from. Managers only.
export default async function TemplatesView({ user, sp, tabs }: { user: SessionUser; sp: { ok?: string; status?: string }; tabs: React.ReactNode }) {
  const showArchived = sp.status === "ARCHIVED";
  const [rows, used, checklists] = await Promise.all([
    db.projectTemplate.findMany({ where: { organizationId: user.organizationId }, orderBy: { name: "asc" } }),
    db.project.groupBy({ by: ["templateId"], where: { organizationId: user.organizationId, templateId: { not: null } }, _count: { _all: true } }),
    listSavedChecklists(db, user.organizationId),
  ]);
  const planName = new Map((await db.servicePlan.findMany({ where: { organizationId: user.organizationId, id: { in: rows.flatMap((t) => t.planIds) } }, select: { id: true, name: true } })).map((x) => [x.id, x.name]));
  const usedBy = new Map(used.map((u) => [u.templateId, u._count._all]));
  const live = rows.filter((t) => !t.archivedAt), archived = rows.filter((t) => t.archivedAt);
  const list = showArchived ? archived : live;
  const have = new Set(rows.map((t) => t.name.toLowerCase()));
  const starterMissing = STARTER_TEMPLATES.some((s) => !have.has(s.name.toLowerCase()));
  return (
    <div className="space-y-5">
      <PageHeader title="Projects" subtitle="Delivery work, progress and deadlines in one place." actions={<NewButton href="/projects/templates/new">New template</NewButton>} />
      {tabs}
      {sp.ok && <Notice kind="ok">{sp.ok}</Notice>}
      <p className="text-sm text-muted">A template is a ready plan: team roles, milestones and tasks with due days, estimates and labels. Choose one under New project and the whole plan is created in one step, with tasks given to the people you pick for each role.</p>
      <details className="card text-sm">
        <summary className="cursor-pointer font-medium">What happens automatically</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">
          <li>A task sent to Review tells the project manager (and whoever created the task).</li>
          <li>When the last task of a milestone is done, the milestone is marked done and the project manager is told. If the milestone has a billing amount and the project has a client, a draft invoice is made and finance is asked to check and issue it. Nothing is issued or posted on its own. Reopening one of its tasks puts the milestone back in progress, until it is invoiced.</li>
          <li>When a deal is won for a service linked to a template (open the template, &quot;Start automatically when a deal is won&quot;), the client&apos;s project is made from it with the template&apos;s usual people, once per deal.</li>
        </ul>
      </details>
      {starterMissing && (
        <form action={addStarterTemplatesAction} className="card flex flex-wrap items-center justify-between gap-3">
          <div><p className="font-medium">Starter templates</p><p className="text-sm text-muted">Social media retainer and Ads campaign, ready to change to fit how your team works.</p></div>
          <SubmitButton className="btn-ghost" pendingText="Adding…">Add starter templates</SubmitButton>
        </form>
      )}
      {archived.length > 0 && <Chips current={showArchived ? "ARCHIVED" : "live"} items={[{ key: "live", label: "In use", count: live.length, href: "/projects?view=templates" }, { key: "ARCHIVED", label: "Archived", count: archived.length, href: "/projects?view=templates&status=ARCHIVED" }]} />}
      {list.length === 0 ? (
        <Empty title={showArchived ? "No archived templates" : "No templates yet"}>{showArchived ? "Archived templates appear here." : "Add the starter templates, press New template, or open a finished project and use Settings → Save as template."}</Empty>
      ) : (
        <div className="card overflow-x-auto !p-0">
          <table className="w-full text-sm">
            <thead className="bg-hover/60 text-left text-xs text-muted"><tr><th className="px-4 py-2.5">Template</th><th className="pr-4">Roles</th><th className="pr-4">Milestones</th><th className="pr-4">Tasks</th><th className="pr-4">Projects made</th><th className="pr-4"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {list.map((t) => {
                const b = parseTemplateBody(t.body);
                const tasks = b.ok ? b.value.tasks.length + b.value.tasks.reduce((n, x) => n + x.subtasks.length, 0) : 0;
                return (
                  <tr key={t.id} className="border-t border-border align-top transition hover:bg-hover/50">
                    <td className="px-4 py-3"><Link href={`/projects/templates/${t.id}`} className="font-medium hover:underline">{t.name}</Link>{t.description && <p className="max-w-md text-xs text-muted">{t.description}</p>}{!b.ok && <p className="mt-1"><Badge tone="danger">needs fixing</Badge></p>}{t.planIds.some((x) => planName.has(x)) && <p className="mt-1 text-xs text-primary">Starts automatically when a deal is won for {t.planIds.map((x) => planName.get(x)).filter(Boolean).join(", ")}</p>}</td>
                    <td className="py-3 pr-4 text-muted">{b.ok ? b.value.roles.join(", ") || "None" : ""}</td>
                    <td className="py-3 pr-4">{b.ok ? b.value.milestones.length : ""}</td>
                    <td className="py-3 pr-4">{b.ok ? tasks : ""}</td>
                    <td className="py-3 pr-4">{usedBy.get(t.id) ?? 0}</td>
                    <td className="py-2 pr-4">
                      <div className="flex justify-end gap-2">
                        {!t.archivedAt && <Link className="btn-ghost" href={`/projects?new=1&template=${t.id}`}>Use</Link>}
                        <form action={archiveTemplateAction}>
                          <input type="hidden" name="id" value={t.id} />
                          {t.archivedAt ? <><input type="hidden" name="restore" value="1" /><SubmitButton className="btn-ghost" pendingText="Restoring…">Restore</SubmitButton></> : (
                            <ConfirmButton title={`Archive ${t.name}?`} message="It stops appearing under New project. Projects already made from it keep all their tasks. You can restore it later.">Archive</ConfirmButton>
                          )}
                        </form>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <section className="space-y-3">
        <div><h2 className="font-semibold">Saved checklists</h2><p className="text-sm text-muted">Checklists anyone working a task can add in one step (QA before posting, ad launch checks…). Save one from a task&apos;s checklist in its task panel.</p></div>
        {checklists.length === 0 ? <Empty title="No saved checklists yet">Open a task, add its checklist items, then use &quot;Save this checklist for other tasks&quot;.</Empty> : (
          <ul className="card divide-y divide-border !p-0 text-sm">
            {checklists.map((c) => (
              <li key={c.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0"><p className="font-medium">{c.name} <span className="text-xs font-normal text-muted">{c.items.length} items</span></p><p className="text-xs text-muted">{c.items.slice(0, 4).join(" · ")}{c.items.length > 4 ? " · …" : ""}</p></div>
                <form action={deleteSavedChecklistAction}>
                  <input type="hidden" name="id" value={c.id} />
                  <ConfirmButton title={`Delete ${c.name}?`} message="It stops being offered on tasks. Tasks that already have its items keep them.">Delete</ConfirmButton>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
