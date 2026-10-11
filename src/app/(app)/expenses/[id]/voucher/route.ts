import { audit, requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { voucherPdf } from "@/lib/pdf";
import { loadVoucherDoc } from "@/lib/pdf-data";
import { notFound, pdfResponse } from "@/lib/pdf-response";

export const dynamic = "force-dynamic";

// Same rule as the voucher page: your own vouchers, or anyone's with expenses.view
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const v = await db.expenseVoucher.findFirst({ where: { id, organizationId: user.organizationId } });
  if (!v || (v.submittedById !== user.id && !user.permissions.has("expenses.view"))) return notFound();
  const doc = await loadVoucherDoc(db, { organizationId: user.organizationId, voucherId: id });
  if (!doc) return notFound();
  await audit(user, { action: "document.voucher_pdf", entity: "ExpenseVoucher", entityId: id });
  return pdfResponse(await voucherPdf(doc), `voucher-${doc.number}`);
}
