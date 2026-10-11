import { audit, requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { payslipPdf } from "@/lib/pdf";
import { loadPayslipDoc } from "@/lib/pdf-data";
import { notFound, pdfResponse } from "@/lib/pdf-response";

export const dynamic = "force-dynamic";

// The same rule as the payslip page: your own once the run is approved, or anyone's with payroll.view
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const item = await db.payrollItem.findUnique({ where: { id }, include: { run: true } });
  if (!item || item.run.organizationId !== user.organizationId) return notFound();
  const own = item.userId === user.id && user.permissions.has("self.payslip") && item.run.status !== "DRAFT";
  if (!own && !user.permissions.has("payroll.view")) return notFound();
  const doc = await loadPayslipDoc(db, { organizationId: user.organizationId, itemId: id });
  if (!doc) return notFound();
  await audit(user, { action: "document.payslip_pdf", entity: "PayrollItem", entityId: id });
  return pdfResponse(await payslipPdf(doc), `payslip-${doc.period}`, false);
}
