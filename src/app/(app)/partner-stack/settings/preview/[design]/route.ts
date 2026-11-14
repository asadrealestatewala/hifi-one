import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { samplePartnerCertificate } from "@/lib/partner-stack";
import { notFound, pdfResponse } from "@/lib/pdf-response";

export const dynamic = "force-dynamic";

// A sample certificate in one design, filled with example details and the saved signatory, so the admin can compare designs.
export async function GET(_req: Request, { params }: { params: Promise<{ design: string }> }) {
  const user = await requirePermission("partners.settings");
  const { design } = await params;
  const pdf = await samplePartnerCertificate(db, user.organizationId, design);
  if (!pdf) return notFound();
  return pdfResponse(pdf, `Hifi-Partner-Stack-sample-${design}`);
}
