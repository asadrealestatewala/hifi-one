import "server-only";
import type { Prisma } from "@prisma/client";
import type { SessionUser } from "./auth";

// Record-level scope: see all projects, or only those you manage or belong to.
export function projectScope(user: SessionUser): Prisma.ProjectWhereInput {
  const base: Prisma.ProjectWhereInput = { organizationId: user.organizationId };
  if (user.permissions.has("projects.view_all")) return base;
  return { ...base, OR: [{ managerId: user.id }, { members: { some: { userId: user.id } } }] };
}
