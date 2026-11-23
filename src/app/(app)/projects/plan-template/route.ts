import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { loadPlanContext, TEMPLATE_HEADERS } from "@/lib/week-plan";
import { buildXlsx, XLSX_TYPE } from "@/lib/xlsx";

export const dynamic = "force-dynamic";

// The Excel template for Plan the week: an empty "Week plan" sheet with the headings, and a "Help" sheet listing the days of
// the week, the people and the projects this manager plans, spelt as the upload expects them. Only for whoever plans work.
export async function GET(req: Request) {
  const user = await requirePermission("tasks.edit");
  const { ctx } = await loadPlanContext(db, user, new URL(req.url).searchParams.get("week"));
  if (ctx.projects.length === 0) return new Response("You do not manage any open project, so there is nothing to plan.", { status: 403 });
  const people = new Map(ctx.people.map((u) => [u.id, u]));
  const help: (string | null)[][] = [
    ["How to fill the Week plan sheet"],
    ["One row per task. Person, Project, Day and Task are required."],
    ["Person: the name as below, or their email. Project: the name or the number. Day: Mon to Sun, or the date."],
    ["Priority: Low, Medium or High (empty is Medium). Due time: such as 15:00 or 3 pm (empty is the end of the office day). Hours: such as 2 or 1.5."],
    ["Then on the Planner press Upload, check the rows, and press Add tasks. Nothing is saved until you do."],
    [],
    ["Days of this week"],
    ...ctx.days.map((d) => [d.label, d.date, d.working ? null : "day off"]),
    [],
    ["Project", "Number", "Team"],
    ...ctx.projects.map((p) => [p.name, p.number, p.team.map((id) => people.get(id)?.name).filter(Boolean).join(", ") || "nobody yet: add the team first"]),
    [],
    ["Person", "Email"],
    ...ctx.people.map((u) => [u.name, u.email]),
  ];
  const bytes = buildXlsx([
    { name: "Week plan", rows: [[...TEMPLATE_HEADERS]], widths: [22, 28, 12, 48, 10, 10, 8], textColumns: true },
    { name: "Help", rows: help, widths: [40, 16, 60] },
  ]);
  return new Response(Buffer.from(bytes), { headers: { "content-type": XLSX_TYPE, "content-disposition": `attachment; filename="week-plan-${ctx.week}.xlsx"`, "cache-control": "no-store" } });
}
