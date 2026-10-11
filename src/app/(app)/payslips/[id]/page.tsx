import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import PrintButton from "@/components/PrintButton";

export const dynamic = "force-dynamic";

export default async function Payslip({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const item = await db.payrollItem.findUnique({ where: { id }, include: { run: true } });
  if (!item || item.run.organizationId !== user.organizationId) notFound();
  // Own payslip once the run is approved; anyone with payroll.view can see any (including drafts).
  const own = item.userId === user.id && user.permissions.has("self.payslip") && item.run.status !== "DRAFT";
  if (!own && !user.permissions.has("payroll.view")) notFound();
  const [person, profile, co] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { id: item.userId } }),
    db.employeeProfile.findUnique({ where: { userId: item.userId } }),
    db.companyProfile.findFirst({ where: { organizationId: user.organizationId, isDefault: true } }),
  ]);
  const cur = item.run.currency;
  const row = (label: string, v: unknown, neg = false) => (
    <div className="flex justify-between border-t border-border py-1.5"><dt>{label}</dt><dd>{neg ? "−" : ""}{formatMoney(Number(v), cur)}</dd></div>
  );
  return (
    <div className="space-y-4 max-w-xl">
      <div className="flex gap-3 print:hidden"><Link href="/me/payslips" className="text-sm text-muted hover:underline">← My payslips</Link><PrintButton /></div>
      <article className="card space-y-4">
        <header>
          <h1 className="text-xl font-bold">Payslip {item.run.period}</h1>
          <p className="text-sm text-muted">{co?.legalName} · Confidential</p>
          {item.run.status === "DRAFT" && <p className="text-sm text-brand font-semibold">Draft, not yet approved</p>}
        </header>
        <p className="text-sm">{person.name} · {profile?.employeeNo} {profile?.designation && `· ${profile.designation}`}</p>
        <dl className="text-sm">
          {row("Basic salary", item.basic)}
          {row("Allowances", item.allowance)}
          {Number(item.bonus) > 0 && row("Bonus", item.bonus)}
          {Number(item.unpaidDeduction) > 0 && row(`Unpaid leave (${item.unpaidDays.toString()} of ${item.workingDays} working days)`, item.unpaidDeduction, true)}
          {row("Gross pay", item.gross)}
          {row(`Tax withheld (${item.taxPercent.toString()}%)`, item.tax, true)}
          <div className="flex justify-between border-t-2 border-border py-2 font-bold"><dt>Net pay</dt><dd>{formatMoney(Number(item.net), cur)}</dd></div>
        </dl>
        <p className="text-xs text-muted">Status of this payroll run: {item.run.status.toLowerCase()}.</p>
      </article>
    </div>
  );
}
