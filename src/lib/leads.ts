import "server-only";
import type { Prisma } from "@prisma/client";
import type { SessionUser } from "./auth";

// Record-level scope: managers see every lead, agents only their own.
export function leadScope(user: SessionUser): Prisma.LeadWhereInput {
  const base: Prisma.LeadWhereInput = { organizationId: user.organizationId };
  if (user.permissions.has("crm.view_all")) return base;
  return { ...base, OR: [{ assignedToId: user.id }, { createdById: user.id }] };
}

export function normalizePhone(p: string | null | undefined): string | null {
  const d = (p ?? "").replace(/[^\d+]/g, "");
  return d.length >= 6 ? d : null;
}
