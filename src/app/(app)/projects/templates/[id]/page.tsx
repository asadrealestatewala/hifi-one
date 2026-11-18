import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { parseTemplateBody, type TemplateBody } from "@/lib/project-templates";
import { Notice, PageHeader } from "@/components/ui";
import TemplateEditor from "./TemplateEditor";

export const dynamic = "force-dynamic";

// One project template: its roles, milestones and tasks. "new" starts an empty one.
export default async function TemplatePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string }> }) {
  const user = await requirePermission("projects.manage");
  const { id } = await params;
  const sp = await searchParams;
  const empty: TemplateBody = { roles: [], milestones: [], tasks: [] };
  // People who can lead or fill roles, and the service plans a won deal can be sold under
  const [staff, plans] = await Promise.all([
    db.user.findMany({ where: { organizationId: user.organizationId, active: true, userType: "EMPLOYEE" }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.servicePlan.findMany({ where: { organizationId: user.organizationId, active: true }, orderBy: [{ category: { name: "asc" } }, { sortOrder: "asc" }], select: { id: true, name: true, category: { select: { name: true } } } }),
  ]);
  const options = { staff, plans: plans.map((x) => ({ id: x.id, name: x.name, category: x.category.name })) };
  const noDefaults = { planIds: [], defaultManagerId: null, roleDefaults: {} };
  if (id === "new") {
    return (
      <div className="space-y-5">
        <PageHeader title="New template" subtitle="Roles, milestones and tasks a project can start from." back={{ href: "/projects?view=templates", label: "Templates" }} />
        <TemplateEditor initial={{ name: "", description: "", body: empty, defaults: noDefaults }} options={options} />
      </div>
    );
  }
  const t = await db.projectTemplate.findFirst({ where: { id, organizationId: user.organizationId } });
  if (!t) notFound();
  const parsed = parseTemplateBody(t.body);
  const used = await db.project.count({ where: { organizationId: user.organizationId, templateId: t.id } });
  return (
    <div className="space-y-5">
      <PageHeader title={t.name} subtitle={`${used} ${used === 1 ? "project" : "projects"} made from this template. Changes apply to new projects only.`} back={{ href: "/projects?view=templates", label: "Templates" }} />
      {sp.saved && <Notice kind="ok">Template saved.</Notice>}
      {t.archivedAt && <Notice kind="error">This template is archived, so New project does not offer it. Restore it from the Templates tab.</Notice>}
      {!parsed.ok && <Notice kind="error">This template could not be read ({parsed.error}). Saving it again replaces it with what is shown here.</Notice>}
      <TemplateEditor key={t.updatedAt.toISOString()} options={options}
        initial={{ id: t.id, name: t.name, description: t.description ?? "", body: parsed.ok ? parsed.value : empty, defaults: { planIds: t.planIds, defaultManagerId: t.defaultManagerId, roleDefaults: (t.roleDefaults ?? {}) as Record<string, string> } }} />
    </div>
  );
}
