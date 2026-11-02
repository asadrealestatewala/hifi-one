import { db } from "@/lib/db";
import { isResponse, json, requireMobileUser } from "@/lib/mobile-api";

export const dynamic = "force-dynamic";

// The caller's own tasks, the same list as My tasks on the website. ?show=open (default) | done | all, ?page=1.. (25 per page).
export async function GET(req: Request) {
  const a = await requireMobileUser(req);
  if (isResponse(a)) return a;
  const { user } = a;
  const url = new URL(req.url);
  const show = url.searchParams.get("show") === "done" ? "done" : url.searchParams.get("show") === "all" ? "all" : "open";
  const page = Math.max(1, Math.floor(Number(url.searchParams.get("page"))) || 1);
  const take = 25;
  const where = {
    assigneeId: user.id, parentId: null, project: { organizationId: user.organizationId, status: { not: "CANCELLED" as const } },
    ...(show === "all" ? {} : show === "done" ? { status: "DONE" as const } : { status: { not: "DONE" as const } }),
  };
  const [rows, total] = await Promise.all([
    db.task.findMany({
      where, include: { project: { select: { id: true, name: true, number: true } } },
      orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }, { id: "asc" }], skip: (page - 1) * take, take,
    }),
    db.task.count({ where }),
  ]);
  return json({
    page, pages: Math.max(1, Math.ceil(total / take)), total,
    tasks: rows.map((t) => ({
      id: t.id, title: t.title, description: t.description, status: t.status, priority: t.priority, blocked: t.blocked,
      dueDate: t.dueDate?.toISOString() ?? null, project: { id: t.project.id, name: t.project.name, number: t.project.number },
    })),
  });
}
