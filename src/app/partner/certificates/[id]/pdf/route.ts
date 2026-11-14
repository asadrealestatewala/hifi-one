import { requirePartnerUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { certificatePdfFor } from "@/lib/partner-stack";
import { notFound, pdfResponse } from "@/lib/pdf-response";

export const dynamic = "force-dynamic";

// A partner downloads their own certificate. The earner comes from the session, so another partner's id finds nothing.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { user, earner } = await requirePartnerUser();
  const { id } = await params;
  const pdf = await certificatePdfFor(db, id, { organizationId: user.organizationId, earnerId: earner.id });
  if (!pdf || pdf.cert.status === "REVOKED") return notFound();
  return pdfResponse(pdf.bytes, pdf.filename.replace(/\.pdf$/, ""), false);
}
