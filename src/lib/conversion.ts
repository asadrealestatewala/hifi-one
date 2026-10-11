// Controlled Closed Won workflow. Free of Next.js imports so it can be tested against the database.
import type { PrismaClient } from "@prisma/client";
import { LedgerError } from "./ledger-math";
import { onLeadConverted } from "./crm-contacts";
import { computeInvoiceTotals } from "./ledger-math";

export type ConversionResult = { clientId: string; invoiceId: string | null; alreadyConverted: boolean };

// Turns a lead into a client (linking an existing one instead of duplicating) and, when a deal value
// exists, a DRAFT invoice. The invoice is not issued: issuing needs finance approval.
// Safe to retry: a second call returns the first result and creates nothing.
export async function convertLead(
  db: PrismaClient,
  p: { organizationId: string; leadId: string; actorId: string; wonStageId: string },
): Promise<ConversionResult> {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Lead" WHERE id = ${p.leadId} FOR UPDATE`;
    const lead = await tx.lead.findFirst({ where: { id: p.leadId, organizationId: p.organizationId }, include: { plan: true } });
    if (!lead) throw new LedgerError("Lead not found.");
    if (lead.clientId) {
      const inv = await tx.invoice.findFirst({ where: { clientId: lead.clientId, notes: { contains: `Lead L-${lead.number}` } } });
      return { clientId: lead.clientId, invoiceId: inv?.id ?? null, alreadyConverted: true };
    }
    const name = (lead.company ?? lead.name).trim();
    // Reuse an existing client with the same name or email rather than creating a duplicate
    let client = await tx.client.findFirst({
      where: {
        organizationId: p.organizationId,
        OR: [{ name: { equals: name, mode: "insensitive" } }, ...(lead.email ? [{ email: lead.email }] : [])],
      },
    });
    if (!client) {
      const seq = await tx.numberSequence.upsert({
        where: { organizationId_key: { organizationId: p.organizationId, key: "CLIENT" } },
        create: { organizationId: p.organizationId, key: "CLIENT", next: 2 },
        update: { next: { increment: 1 } },
      });
      client = await tx.client.create({
        data: {
          organizationId: p.organizationId, code: `C-${String(seq.next - 1).padStart(4, "0")}`, name,
          email: lead.email, phone: lead.phone, country: lead.country, currency: lead.currency,
        },
      });
    }
    let invoiceId: string | null = null;
    if (lead.dealValue && lead.dealValue.gt(0)) {
      const description = lead.plan?.name ?? lead.serviceInterest ?? "Agreed services";
      const t = computeInvoiceTotals([{ quantity: 1, unitPrice: lead.dealValue }], 0);
      const inv = await tx.invoice.create({
        data: {
          organizationId: p.organizationId, clientId: client.id, currency: lead.currency, taxRate: 0,
          subtotal: t.subtotal, taxAmount: t.taxAmount, total: t.total, createdById: p.actorId,
          notes: `Created from Lead L-${lead.number}. Review amounts and tax before issuing.`,
          lines: { create: [{ description, quantity: 1, unitPrice: lead.dealValue, amount: t.amounts[0] }] },
        },
      });
      invoiceId = inv.id;
    }
    const prev = await tx.pipelineStage.findUniqueOrThrow({ where: { id: lead.stageId } });
    await tx.lead.update({
      where: { id: lead.id },
      data: { clientId: client.id, convertedAt: new Date(), stageId: p.wonStageId, stageChangedAt: new Date() },
    });
    await tx.leadActivity.create({
      data: {
        leadId: lead.id, actorId: p.actorId, kind: "STAGE_CHANGE",
        body: `${prev.name} → Closed Won. Linked to client ${client.code ?? client.name}${invoiceId ? " and created a draft invoice" : ""}. Activity history is kept on the lead.`,
      },
    });
    await onLeadConverted(tx, { leadId: lead.id, clientId: client.id, clientCode: client.code });
    return { clientId: client.id, invoiceId, alreadyConverted: false };
  });
}
