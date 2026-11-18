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
  if (id === "new") {
    return (
      <div className="space-y-5">
        <PageHeader title="New template" subtitle="Roles, milestones and tasks a project can start from." back={{ href: "/projects?view=templates", label: "Templates" }} />
        <TemplateEditor initial={{ name: "", description: "", body: empty }} />
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
      <TemplateEditor key={t.updatedAt.toISOString()} initial={{ id: t.id, name: t.name, description: t.description ?? "", body: parsed.ok ? parsed.value : empty }} />
    </div>
  );
}
