import type { Prisma } from "@prisma/client";

// Record-level scope: managers see every lead, agents only their own.
export function leadScope(user: { id: string; organizationId: string; permissions: ReadonlySet<string> }): Prisma.LeadWhereInput {
  const base: Prisma.LeadWhereInput = { organizationId: user.organizationId };
  if (user.permissions.has("crm.view_all")) return base;
  return { ...base, OR: [{ assignedToId: user.id }, { createdById: user.id }] };
}
