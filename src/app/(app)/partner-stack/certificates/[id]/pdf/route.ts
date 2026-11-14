import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { certificatePdfFor } from "@/lib/partner-stack";
import { notFound, pdfResponse } from "@/lib/pdf-response";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("partners.manage");
  const { id } = await params;
  const pdf = await certificatePdfFor(db, id, { organizationId: user.organizationId });
  if (!pdf) return notFound();
  return pdfResponse(pdf.bytes, pdf.filename.replace(/\.pdf$/, ""));
}
