// Editing a client's own details after it was created: name, contact details, address, tax ID and payment terms.
// Billing currency is NOT editable here: invoices, payments and the ledger already use it.
// Payment terms only set the due date of invoices created from now on; issued invoices keep their due dates.
import { z } from "zod";
import type { PrismaClient } from "@prisma/client";

export class ClientDetailsError extends Error {}

const opt = z.string().trim().max(300).optional().transform((v) => (v ? v : null));
export const clientDetailsSchema = z.object({
  name: z.string().trim().min(2, "Client name is required").max(200),
  email: z.string().trim().email("Enter a valid email").or(z.literal("")).optional().transform((v) => (v ? v.toLowerCase() : null)),
  phone: opt,
  country: opt,
  taxId: opt,
  billingAddress: z.string().trim().max(1000).optional().transform((v) => (v ? v : null)),
  paymentTermsDays: z.coerce.number({ message: "Payment terms must be a number of days" }).int("Payment terms must be whole days").min(0, "Payment terms cannot be negative").max(365, "Payment terms can be at most 365 days"),
});
export type ClientDetails = z.infer<typeof clientDetailsSchema>;

const FIELDS = ["name", "email", "phone", "country", "taxId", "billingAddress", "paymentTermsDays"] as const;

// Returns what changed (before and after) for the audit log; nothing is written when nothing changed.
export async function updateClientDetails(db: PrismaClient, p: { organizationId: string; clientId: string; input: Record<string, unknown> }) {
  const parsed = clientDetailsSchema.safeParse(p.input);
  if (!parsed.success) throw new ClientDetailsError(parsed.error.issues[0].message);
  const next = parsed.data;
  const current = await db.client.findFirst({ where: { id: p.clientId, organizationId: p.organizationId } });
  if (!current) throw new ClientDetailsError("Client not found.");
  if (next.name.toLowerCase() !== current.name.toLowerCase()) {
    const dup = await db.client.findFirst({ where: { organizationId: p.organizationId, id: { not: current.id }, name: { equals: next.name, mode: "insensitive" } } });
    if (dup) throw new ClientDetailsError("Another client already has this name.");
  }
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  for (const f of FIELDS) if (current[f] !== next[f]) { before[f] = current[f]; after[f] = next[f]; }
  if (Object.keys(after).length === 0) return { changed: false as const, before, after };
  await db.client.update({ where: { id: current.id }, data: after });
  return { changed: true as const, before, after };
}
