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

export const OWNER_TYPES = ["EXPENSE", "VENDOR_BILL", "CONTENT", "EMPLOYEE", "CONTRACT", "CONTACT", "TASK", "USER_PHOTO", "VENDOR_DOC", "JOB_APPLICATION", "PROSPECT_VISIT", "CIRCULAR", "CHAT_MESSAGE", "PROJECT_ASSET", "EMPLOYEE_REQUEST"] as const;
export type OwnerType = (typeof OWNER_TYPES)[number];
export type Mode = "read" | "upload" | "delete";

const CLIENT_VISIBLE = ["CLIENT_REVIEW", "CHANGES_REQUESTED", "APPROVED", "SCHEDULED", "PUBLISHED"];
const CONTENT_EDITABLE = ["DRAFT", "INTERNAL_REVIEW", "CHANGES_REQUESTED"];

// What a person may do in one project's asset library. Reading follows the project's own visibility; adding needs the right to edit tasks
// on a project you belong to (or manage); removing, renaming folders and sharing are for the project manager and people who manage projects.
export async function projectAssetRights(db: PrismaClient, a: FileActor, projectId: string): Promise<{ read: boolean; upload: boolean; manage: boolean }> {
  const none = { read: false, upload: false, manage: false };
  if (a.userType !== "EMPLOYEE") return none;
  const p = await db.project.findFirst({ where: { id: projectId, organizationId: a.organizationId }, include: { members: { select: { userId: true } } } });
  if (!p || !a.permissions.has("projects.view")) return none;
  const manager = p.managerId === a.id || a.permissions.has("projects.manage");
  const inProject = a.permissions.has("projects.view_all") || p.managerId === a.id || p.members.some((m) => m.userId === a.id);
  if (!inProject) return none;
  return { read: true, upload: manager || a.permissions.has("tasks.edit"), manage: manager };
}

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

  if (ownerType === "CHAT_MESSAGE") {
    // A picture sent in team chat: only people currently in that room may see it; only the sender adds or removes it
    const m = await db.chatMessage.findFirst({ where: { id: ownerId, deletedAt: null, room: { organizationId: a.organizationId } }, select: { senderId: true, roomId: true } });
    if (!m || !has("chat.use")) return false;
    const member = await db.chatMember.findFirst({ where: { roomId: m.roomId, userId: a.id, leftAt: null }, select: { userId: true } });
    if (!member) return false;
    return mode === "read" ? true : m.senderId === a.id;
  }

  if (ownerType === "USER_PHOTO") {
    // A profile picture: any staff member of the organization may see it; only the person, or HR, may change it
    const u = await db.user.findFirst({ where: { id: ownerId, organizationId: a.organizationId, userType: "EMPLOYEE" }, select: { id: true } });
    if (!u || !staff) return false;
    return mode === "read" ? true : a.id === ownerId || has("hr.manage");
  }

  if (ownerType === "TASK") {
    // Same visibility as the project: members, its manager, or people who can see all projects
    const t = await db.task.findUnique({ where: { id: ownerId }, include: { project: { include: { members: true } } } });
    if (!t || t.project.organizationId !== a.organizationId || !staff) return false;
    const inProject = a.permissions.has("projects.view_all") || t.project.managerId === a.id || t.project.members.some((m) => m.userId === a.id);
    if (!inProject || !has("projects.view")) return false;
    if (mode === "read") return true;
    const manager = a.permissions.has("projects.manage") || t.project.managerId === a.id;
    return (manager || t.assigneeId === a.id) && has("tasks.edit") && !["COMPLETED", "CANCELLED"].includes(t.project.status);
  }

  if (ownerType === "PROJECT_ASSET") {
    // A version of a file in a project's asset library: same visibility as the project; project members add, the project manager removes
    const as = await db.projectAsset.findFirst({ where: { id: ownerId, organizationId: a.organizationId, deletedAt: null }, select: { projectId: true } });
    if (!as) return false;
    const r = await projectAssetRights(db, a, as.projectId);
    return mode === "read" ? r.read : mode === "upload" ? r.upload : r.manage;
  }

  if (ownerType === "CONTACT") {
    // Same visibility as the contact itself: managers see all, others see what they own, follow or created
    const k = await db.contact.findFirst({ where: { id: ownerId, organizationId: a.organizationId } });
    if (!k) return false;
    const mine = a.permissions.has("crm.view_all") || k.ownerId === a.id || k.createdById === a.id || k.followers.includes(a.id);
    if (!staff || !mine) return false;
    return mode === "read" ? has("crm.view") : has("crm.edit");
  }

  if (ownerType === "VENDOR_DOC") {
    // Compliance documents of a vendor (registration, tax certificate, insurance). The vendor's own people may add and see them;
    // staff see them with vendors.view and manage them with vendors.manage.
    const v = await db.vendor.findFirst({ where: { id: ownerId, organizationId: a.organizationId }, select: { id: true } });
    if (!v) return false;
    const own = a.userType === "VENDOR" && a.vendorId === v.id;
    if (mode === "read") return own || has("vendors.view");
    return own || has("vendors.manage");
  }

  if (ownerType === "CONTRACT") {
    const k = await db.contract.findFirst({ where: { id: ownerId, organizationId: a.organizationId } });
    if (!k) return false;
    if (mode === "read") return has("contracts.view");
    return has("contracts.manage") && k.status !== "TERMINATED";
  }

  if (ownerType === "JOB_APPLICATION") {
    // An applicant's CV from the careers page: HR reads it with hr.view and manages it with hr.manage. Applicants upload through
    // the public apply form (job-applications.ts), never through a staff screen.
    const app = await db.jobApplication.findFirst({ where: { id: ownerId, organizationId: a.organizationId }, select: { id: true } });
    if (!app) return false;
    return mode === "read" ? has("hr.view") : has("hr.manage");
  }

  if (ownerType === "PROSPECT_VISIT") {
    // Photos a field agent took at a visit (premises, visiting card). Seen by the agent who made the visit, whoever the prospect is assigned to,
    // the onboarding team that books the demo (decision 73), whoever owns the lead it became, and sales managers; added only by the visiting
    // agent (same device, same day's work) or a manager; removed by a manager or the agent.
    const v = await db.prospectVisit.findFirst({ where: { id: ownerId, organizationId: a.organizationId }, select: { agentId: true, prospect: { select: { assignedToId: true, addedById: true, leadId: true } } } });
    if (!v || !staff) return false;
    const manager = has("crm.view_all") && has("crm.edit");
    const mine = v.agentId === a.id;
    if (mode === "read") {
      if (!has("crm.view")) return false;
      if (manager || mine || v.prospect.assignedToId === a.id || v.prospect.addedById === a.id || has("prospector.schedule_demo")) return true;
      return Boolean(v.prospect.leadId) && (await db.lead.count({ where: { id: v.prospect.leadId!, OR: [{ assignedToId: a.id }, { createdById: a.id }] } })) > 0;
    }
    return has("field.capture") && (mine || manager);
  }

  if (ownerType === "CIRCULAR") {
    // A PDF or picture attached to an HR circular. Added (before the circular is sent) and removed only by people who may send circulars;
    // read by those people and by the staff the circular was addressed to, nobody else.
    if (!staff) return false;
    if (mode !== "read") return has("circulars.send");
    const c = await db.circular.findFirst({ where: { id: ownerId, organizationId: a.organizationId }, select: { id: true } });
    if (!c) return false;
    if (has("circulars.send")) return true;
    return (await db.circularRecipient.count({ where: { circularId: c.id, userId: a.id } })) > 0;
  }

  if (ownerType === "EMPLOYEE_REQUEST") {
    // A file attached to an employee's application to HR: the employee and HR (hr.manage) read it; the employee adds files while the
    // request is still open, HR at any time; removal follows the same rule. Managers never see these (a grievance may be about them).
    const r = await db.employeeRequest.findFirst({ where: { id: ownerId, organizationId: a.organizationId }, select: { userId: true, status: true } });
    if (!r || !staff) return false;
    const mine = a.id === r.userId;
    if (mode === "read") return mine || has("hr.manage");
    const open = r.status === "SUBMITTED" || r.status === "IN_REVIEW";
    return (mine && open) || has("hr.manage");
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
