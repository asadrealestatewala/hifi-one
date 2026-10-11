// Who may see, add or remove files on each kind of record. The rule always follows the record the file belongs to,
// so a file is only as visible as its expense, bill, content item or employee file.
import type { PrismaClient } from "@prisma/client";

export type FileActor = {
  id: string;
  organizationId: string;
  userType: string; // EMPLOYEE | CLIENT | VENDOR | ...
  clientId: string | null;
  vendorId: string | null;
  permissions: ReadonlySet<string>;
};

export const OWNER_TYPES = ["EXPENSE", "VENDOR_BILL", "CONTENT", "EMPLOYEE", "CONTRACT"] as const;
export type OwnerType = (typeof OWNER_TYPES)[number];
export type Mode = "read" | "upload" | "delete";

const CLIENT_VISIBLE = ["CLIENT_REVIEW", "CHANGES_REQUESTED", "APPROVED", "SCHEDULED", "PUBLISHED"];
const CONTENT_EDITABLE = ["DRAFT", "INTERNAL_REVIEW", "CHANGES_REQUESTED"];

export async function authorizeOwner(db: PrismaClient, a: FileActor, ownerType: string, ownerId: string, mode: Mode): Promise<boolean> {
  const staff = a.userType === "EMPLOYEE";
  const has = (p: string) => staff && a.permissions.has(p);

  if (ownerType === "EXPENSE") {
    const v = await db.expenseVoucher.findFirst({ where: { id: ownerId, organizationId: a.organizationId } });
    if (!v) return false;
    const mine = staff && v.submittedById === a.id;
    if (mode === "read") return mine || has("expenses.view");
    const open = ["SUBMITTED", "UNDER_REVIEW"].includes(v.status);
    if (mode === "upload") return (mine && open) || has("expenses.review");
    return (mine && open) || has("expenses.approve");
  }

  if (ownerType === "VENDOR_BILL") {
    const b = await db.vendorBill.findFirst({ where: { id: ownerId, organizationId: a.organizationId } });
    if (!b) return false;
    const ownVendor = a.userType === "VENDOR" && a.vendorId !== null && a.vendorId === b.vendorId;
    if (mode === "read") return ownVendor || has("vendors.view");
    return (ownVendor && b.status === "SUBMITTED") || has("vendors.manage");
  }

  if (ownerType === "CONTENT") {
    const c = await db.contentItem.findFirst({ where: { id: ownerId, organizationId: a.organizationId } });
    if (!c) return false;
    if (mode === "read") {
      if (has("content.view")) return true;
      return a.userType === "CLIENT" && a.clientId !== null && a.clientId === c.clientId && CLIENT_VISIBLE.includes(c.status); // never drafts
    }
    return has("content.manage") && CONTENT_EDITABLE.includes(c.status);
  }

  if (ownerType === "CONTRACT") {
    const k = await db.contract.findFirst({ where: { id: ownerId, organizationId: a.organizationId } });
    if (!k) return false;
    if (mode === "read") return has("contracts.view");
    return has("contracts.manage") && k.status !== "TERMINATED";
  }

  if (ownerType === "EMPLOYEE") {
    const profile = await db.employeeProfile.findFirst({ where: { userId: ownerId, organizationId: a.organizationId } });
    if (!profile) return false;
    const self = staff && a.id === ownerId;
    if (mode === "read") return self || has("hr.view_sensitive");
    if (mode === "upload") return self || has("hr.manage");
    return has("hr.manage");
  }
  return false;
}
