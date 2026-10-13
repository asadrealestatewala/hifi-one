import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { isPeriod, periodRange, PERIODS } from "@/lib/dashboard-home";
import { leadScope } from "@/lib/leads";
import { loadLeadsReport } from "@/lib/leads-report";
import { PageHeader } from "@/components/ui";
import LeadsReport from "../../dashboard/LeadsReport";
import PeriodSelect from "../../dashboard/PeriodSelect";

export const dynamic = "force-dynamic";

// The same leads report as the dashboard tab, on its own page. People see only the leads they may see.
export default async function LeadsReportPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const user = await requirePermission("crm.view");
  const sp = await searchParams;
  const profile = await db.companyProfile.findFirst({ where: { organizationId: user.organizationId, isDefault: true } });
  const today = new Date().toLocaleDateString("en-CA", { timeZone: profile?.timezone ?? "UTC" });
  const period = isPeriod(sp.period) ? sp.period : "month";
  const range = periodRange(period, today);
  const [report, staff] = await Promise.all([loadLeadsReport(db, user.organizationId, leadScope(user), range), db.user.findMany({ where: { organizationId: user.organizationId, userType: "EMPLOYEE" }, select: { id: true, name: true } })]);
  return (
    <div className="space-y-5">
      <PageHeader title="Leads report" subtitle={`${PERIODS[period]}, ${range.from} to ${range.to}. ${user.permissions.has("crm.view_all") ? "Every lead in the organization." : "Leads assigned to or created by you."}`} actions={<PeriodSelect value={period} base="/sales/leads-report" />} />
      <LeadsReport r={report} owners={new Map(staff.map((s) => [s.id, s.name]))} from={range.from} to={range.to} />
    </div>
  );
}
