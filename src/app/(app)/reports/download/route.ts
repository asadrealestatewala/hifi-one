import { audit, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { parseRange } from "@/lib/date-range";
import { leadScope } from "@/lib/leads";
import { reportPdf } from "@/lib/pdf";
import { loadReportLetterhead } from "@/lib/pdf-data";
import { pdfResponse } from "@/lib/pdf-response";
import { REPORTS, buildReport, isReportKey, reportCsv } from "@/lib/report-tables";
import { logReportAccess } from "@/lib/monitoring";

export const dynamic = "force-dynamic";

// One download address for every report: /reports/download?report=pl&format=csv|pdf&from=…&to=…
// The permission is the one the on-screen report needs; the figures come from the same loaders. Every download is audited.
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const key = sp.get("report");
  if (!isReportKey(key)) return new Response("Unknown report", { status: 404 });
  const user = await requirePermission(REPORTS[key].permission);
  const format = sp.get("format") === "pdf" ? "pdf" : "csv";
  const today = new Date().toISOString().slice(0, 10);
  const r = parseRange(sp.get("from") ?? undefined, sp.get("to") ?? undefined);
  const to = r.to ?? today;
  const from = r.from ?? (key === "workforce" ? new Date(Date.parse(to) - 6 * 86400000).toISOString().slice(0, 10) : `${to.slice(0, 7)}-01`);
  const org = user.organizationId;
  const table = await buildReport(db, key, {
    organizationId: org, from, to, departmentId: sp.get("dept") || undefined,
    leadWhere: key === "leads" ? leadScope(user) : undefined,
  });
  if (key === "workforce") {
    const ids = (await db.user.findMany({ where: { organizationId: org, userType: "EMPLOYEE", active: true }, select: { id: true } })).map((u) => u.id);
    await logReportAccess(db, { organizationId: org, viewerId: user.id, subjectIds: ids });
  }
  await audit(user, { action: "report.download", entity: "Report", entityId: key, after: { format, from, to } });
  const name = `${key}-${from}-to-${to}`;
  if (format === "csv") {
    return new Response("﻿" + reportCsv(table), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}.csv"`, "cache-control": "no-store" } });
  }
  const { company, config } = await loadReportLetterhead(db, org);
  return pdfResponse(await reportPdf({ ...table, company, config, generatedBy: user.name }), name, false);
}
