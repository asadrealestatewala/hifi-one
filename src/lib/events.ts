// Business events that create work or news for someone else, and who hears about them. Call these after the
// owning service has committed. Each one uses a dedupe key, so a retried action never notifies twice.
// Free of Next.js imports so it can be tested against the test database.
import type { PrismaClient } from "@prisma/client";
import { salesOwnerOf } from "./commissions";
import { formatMoney } from "./money";
import { notify, notifyMany, notifyPermission } from "./notifications";
import { appUrl, firstName, sendTemplateQuietly } from "./email-template-store";

type Db = PrismaClient;

// True the first time this person gets this notice. The email that goes with a notice is sent only then, so a retried or
// repeated assignment never emails twice.
const firstTime = async (db: Db, userId: string, dedupeKey: string) => !(await db.notification.findUnique({ where: { userId_dedupeKey: { userId, dedupeKey } } }));

// The person to email about something assigned to them: active staff with an email address.
const emailable = (db: Db, userId: string) => db.user.findFirst({ where: { id: userId, active: true, userType: "EMPLOYEE", email: { not: null } }, select: { name: true, email: true } });

const portalUsers = async (db: Db, where: { clientId: string } | { vendorId: string }) =>
  (await db.user.findMany({ where: { ...where, active: true }, select: { id: true } })).map((u) => u.id);

// A lead was given to someone other than the person who did it.
export async function leadAssigned(db: Db, p: { organizationId: string; leadId: string; toUserId: string | null; byUserId: string }) {
  if (!p.toUserId || p.toUserId === p.byUserId) return;
  const lead = await db.lead.findFirst({ where: { id: p.leadId, organizationId: p.organizationId }, select: { id: true, name: true, number: true, company: true, email: true, phone: true, source: true } });
  if (!lead) return;
  const key = `lead-assigned:${lead.id}:${p.toUserId}`;
  const fresh = await firstTime(db, p.toUserId, key);
  await notify(db, p.toUserId, { kind: "lead.assigned", title: `Lead assigned to you: ${lead.name}`, body: `L-${lead.number}`, link: `/leads/${lead.id}`, dedupeKey: key });
  const to = fresh ? await emailable(db, p.toUserId) : null;
  if (to) {
    await sendTemplateQuietly(db, {
      organizationId: p.organizationId, key: "lead_assigned", to: to.email!, purpose: "NOREPLY", relatedType: "Lead", relatedId: lead.id, buttonUrl: `${appUrl()}/leads/${lead.id}`,
      vars: { first_name: firstName(to.name), lead_name: lead.name, lead_company: lead.company ?? "", lead_email: lead.email ?? "", lead_phone: lead.phone ?? "", source: lead.source ?? "" },
    });
  }
}

// Several contacts (and their open leads) were given to one person at once.
export async function contactsAssigned(db: Db, p: { toUserId: string; byUserId: string; count: number; batchKey: string }) {
  if (p.toUserId === p.byUserId || p.count === 0) return;
  await notify(db, p.toUserId, { kind: "contact.assigned", title: `${p.count} contact${p.count === 1 ? "" : "s"} assigned to you`, link: `/contacts?owner=${p.toUserId}`, dedupeKey: `contacts-assigned:${p.batchKey}` });
}

// An invoice was issued: the client's portal users can now see it.
export async function invoiceIssued(db: Db, p: { organizationId: string; invoiceId: string }) {
  const inv = await db.invoice.findFirst({ where: { id: p.invoiceId, organizationId: p.organizationId }, select: { id: true, number: true, clientId: true, total: true, currency: true, dueDate: true } });
  if (!inv?.number) return;
  await notifyMany(db, await portalUsers(db, { clientId: inv.clientId }), {
    kind: "invoice.issued", title: `New invoice ${inv.number}`, body: `${formatMoney(inv.total, inv.currency)}${inv.dueDate ? `, due ${inv.dueDate.toISOString().slice(0, 10)}` : ""}`,
    link: `/portal/invoices/${inv.id}`, dedupeKey: `invoice-issued:${inv.id}`,
  });
}

// Money arrived: the salesperson who won the client and the client's portal users hear about it.
export async function paymentReceived(db: Db, p: { organizationId: string; paymentId: string; actorId: string }) {
  const pay = await db.payment.findFirst({ where: { id: p.paymentId, organizationId: p.organizationId }, select: { id: true, number: true, clientId: true, amount: true, currency: true, client: { select: { name: true } } } });
  if (!pay) return;
  const amount = formatMoney(pay.amount, pay.currency);
  const owner = await salesOwnerOf(db, p.organizationId, pay.clientId);
  if (owner && owner !== p.actorId) await notify(db, owner, { kind: "payment.received", title: `${pay.client.name} paid ${amount}`, body: pay.number, link: "/finance/payments", dedupeKey: `payment-owner:${pay.id}` });
  await notifyMany(db, await portalUsers(db, { clientId: pay.clientId }), { kind: "payment.received", title: `Payment received: ${amount}`, body: `Receipt ${pay.number}`, link: "/portal/statement", dedupeKey: `payment-client:${pay.id}` });
}

// The client accepted or declined a quotation in the portal: whoever made it (or else the quote managers) hears.
export async function quoteDecided(db: Db, p: { organizationId: string; quoteId: string }) {
  const q = await db.quote.findFirst({ where: { id: p.quoteId, organizationId: p.organizationId }, select: { id: true, number: true, status: true, createdById: true, client: { select: { name: true } } } });
  if (!q || !["ACCEPTED", "DECLINED"].includes(q.status)) return;
  const n = { kind: `quote.${q.status.toLowerCase()}`, title: `${q.client.name} ${q.status === "ACCEPTED" ? "accepted" : "declined"} quotation ${q.number}`, link: `/quotes/${q.id}`, dedupeKey: `quote-decided:${q.id}` };
  if (q.createdById) await notify(db, q.createdById, n);
  else await notifyPermission(db, p.organizationId, "quotes.manage", n);
}

// Salaries were paid: each person on the run can open their payslip.
export async function payrollPaid(db: Db, p: { organizationId: string; runId: string }) {
  const run = await db.payrollRun.findFirst({ where: { id: p.runId, organizationId: p.organizationId, status: "PAID" }, select: { id: true, period: true } });
  if (!run) return;
  const items = await db.payrollItem.findMany({ where: { runId: run.id }, select: { userId: true } });
  for (const i of items) await notify(db, i.userId, { kind: "payroll.paid", title: `Your salary for ${run.period} has been paid`, link: "/me/payslips", dedupeKey: `payroll-paid:${run.id}:${i.userId}` });
}

// A vendor's bill moved (approved, rejected or paid): the vendor's portal users hear.
export async function vendorBillChanged(db: Db, p: { organizationId: string; billId: string }) {
  const b = await db.vendorBill.findFirst({ where: { id: p.billId, organizationId: p.organizationId }, select: { id: true, number: true, status: true, vendorId: true } });
  if (!b || !["APPROVED", "REJECTED", "PAID"].includes(b.status)) return;
  const what = b.status === "PAID" ? "has been paid" : b.status === "APPROVED" ? "was approved" : "was rejected";
  await notifyMany(db, await portalUsers(db, { vendorId: b.vendorId }), { kind: `vendor_bill.${b.status.toLowerCase()}`, title: `Bill ${b.number} ${what}`, link: "/vendor/work", dedupeKey: `vendor-bill:${b.id}:${b.status}` });
}

// ---------- Projects and tasks: assigning and collaborating ----------

const PROJECT_LINK = (id: string, taskId?: string) => `/projects/${id}${taskId ? `?task=${taskId}` : ""}`;

// A person was added to a project team.
export async function projectMemberAdded(db: Db, p: { organizationId: string; projectId: string; userId: string; byUserId: string; role?: string | null }) {
  if (p.userId === p.byUserId) return;
  const pr = await db.project.findFirst({ where: { id: p.projectId, organizationId: p.organizationId }, select: { id: true, name: true, number: true } });
  if (!pr) return;
  await notify(db, p.userId, { kind: "project.member_added", title: `You were added to the project ${pr.name}`, body: p.role ? `Your role: ${p.role}` : pr.number, link: PROJECT_LINK(pr.id), dedupeKey: `project-member:${pr.id}:${p.userId}` });
}

// A task was given to someone (at creation or by reassigning). Once per task and assignee.
export async function taskAssigned(db: Db, p: { organizationId: string; taskId: string; toUserId: string | null; byUserId: string }) {
  if (!p.toUserId || p.toUserId === p.byUserId) return;
  const t = await db.task.findFirst({ where: { id: p.taskId, project: { organizationId: p.organizationId } }, select: { id: true, title: true, projectId: true, dueDate: true, priority: true, description: true, project: { select: { name: true } } } });
  if (!t) return;
  const key = `task-assigned:${t.id}:${p.toUserId}`;
  const fresh = await firstTime(db, p.toUserId, key);
  await notify(db, p.toUserId, { kind: "task.assigned", title: "A task was assigned to you", body: `${t.title} (${t.project.name})${t.dueDate ? `, due ${t.dueDate.toISOString().slice(0, 10)}` : ""}`, link: PROJECT_LINK(t.projectId, t.id), dedupeKey: key });
  // ...and an email with the task template, so sales and delivery staff see it even when they are not signed in
  const to = fresh ? await emailable(db, p.toUserId) : null;
  if (to) {
    const by = (await db.user.findUnique({ where: { id: p.byUserId }, select: { name: true } }))?.name ?? "A colleague";
    await sendTemplateQuietly(db, {
      organizationId: p.organizationId, key: "task_assigned", to: to.email!, purpose: "NOREPLY", relatedType: "Task", relatedId: t.id, buttonUrl: `${appUrl()}${PROJECT_LINK(t.projectId, t.id)}`,
      vars: {
        first_name: firstName(to.name), task_title: t.title, project: t.project.name, priority: t.priority.charAt(0) + t.priority.slice(1).toLowerCase(),
        due_date: t.dueDate ? t.dueDate.toISOString().slice(0, 10) : "No due date", assigned_by: by, description: (t.description ?? "").slice(0, 600),
      },
    });
  }
}

// A task reached review or done: the project manager and whoever created it hear about it (not the person who moved it).
export async function taskMoved(db: Db, p: { organizationId: string; taskId: string; status: string; byUserId: string }) {
  if (!["REVIEW", "DONE"].includes(p.status)) return;
  const t = await db.task.findFirst({ where: { id: p.taskId, project: { organizationId: p.organizationId } }, select: { id: true, title: true, projectId: true, createdById: true, project: { select: { managerId: true } } } });
  if (!t) return;
  const who = (await db.user.findUnique({ where: { id: p.byUserId }, select: { name: true } }))?.name ?? "Someone";
  const people = [...new Set([t.project.managerId, t.createdById].filter((x): x is string => !!x && x !== p.byUserId))];
  await notifyMany(db, people, { kind: `task.${p.status.toLowerCase()}`, title: p.status === "DONE" ? `${who} finished a task` : `${who} sent a task for review`, body: t.title, link: PROJECT_LINK(t.projectId, t.id), dedupeKey: `task-${p.status}:${t.id}:${Date.now()}` });
}

// A project's status changed: the whole team is told.
export async function projectStatusChanged(db: Db, p: { organizationId: string; projectId: string; status: string; byUserId: string }) {
  const pr = await db.project.findFirst({ where: { id: p.projectId, organizationId: p.organizationId }, select: { id: true, name: true, managerId: true, members: { select: { userId: true } } } });
  if (!pr) return;
  const people = [...new Set([pr.managerId, ...pr.members.map((m) => m.userId)])].filter((x) => x !== p.byUserId);
  await notifyMany(db, people, { kind: "project.status", title: `${pr.name} is now ${p.status.toLowerCase().replace("_", " ")}`, link: PROJECT_LINK(pr.id), dedupeKey: `project-status:${pr.id}:${p.status}:${Date.now()}` });
}

// Names written after @ in a comment ("@Tahira" or "@Tahira Siraj"), matched to members of the project only, so a mention can never
// reveal or reach someone outside it. A first name that matches two members mentions nobody (ambiguous).
export function mentionedMembers(body: string, members: { id: string; name: string }[]): string[] {
  const text = body.toLowerCase();
  const out = new Set<string>();
  for (const m of members) {
    const full = m.name.toLowerCase();
    const first = full.split(/\s+/)[0];
    if (text.includes(`@${full}`)) { out.add(m.id); continue; }
    const sameFirst = members.filter((x) => x.name.toLowerCase().split(/\s+/)[0] === first).length;
    if (sameFirst === 1 && new RegExp(`@${first.replace(/[^a-z0-9]/g, "")}\\b`).test(text.replace(/[^a-z0-9@\s]/g, ""))) out.add(m.id);
  }
  return [...out];
}

// A comment on a task. Mentioned members get a "mentioned you" message; the assignee, creator, project manager and earlier
// commenters get "new comment". Nobody is told twice, and never the author.
export async function taskCommented(db: Db, p: { organizationId: string; taskId: string; commentId: string; authorId: string; body: string }) {
  const t = await db.task.findFirst({ where: { id: p.taskId, project: { organizationId: p.organizationId } }, select: { id: true, title: true, projectId: true, assigneeId: true, createdById: true, project: { select: { managerId: true, members: { select: { userId: true } } } } } });
  if (!t) return;
  const memberIds = [...new Set([t.project.managerId, ...t.project.members.map((m) => m.userId)])];
  const members = await db.user.findMany({ where: { id: { in: memberIds }, active: true }, select: { id: true, name: true } });
  const author = members.find((m) => m.id === p.authorId)?.name ?? (await db.user.findUnique({ where: { id: p.authorId }, select: { name: true } }))?.name ?? "Someone";
  const mentioned = mentionedMembers(p.body, members).filter((x) => x !== p.authorId);
  const earlier = (await db.taskComment.findMany({ where: { taskId: t.id, authorId: { not: p.authorId } }, select: { authorId: true }, distinct: ["authorId"] })).map((c) => c.authorId);
  const watchers = [...new Set([t.assigneeId, t.createdById, t.project.managerId, ...earlier].filter((x): x is string => !!x && x !== p.authorId && !mentioned.includes(x) && memberIds.includes(x)))];
  const snippet = p.body.length > 140 ? p.body.slice(0, 137) + "..." : p.body;
  await notifyMany(db, mentioned, { kind: "task.mention", title: `${author} mentioned you on ${t.title}`, body: snippet, link: PROJECT_LINK(t.projectId, t.id), dedupeKey: `comment:${p.commentId}` });
  await notifyMany(db, watchers, { kind: "task.comment", title: `${author} commented on ${t.title}`, body: snippet, link: PROJECT_LINK(t.projectId, t.id), dedupeKey: `comment:${p.commentId}` });
}

// The client wrote on a task in the portal: the assignee, project manager and task creator are told.
export async function clientCommented(db: Db, p: { organizationId: string; taskId: string; commentId: string; userId: string }) {
  const t = await db.task.findFirst({ where: { id: p.taskId, project: { organizationId: p.organizationId } }, select: { id: true, title: true, projectId: true, assigneeId: true, createdById: true, project: { select: { managerId: true, name: true, clientId: true } } } });
  if (!t) return;
  const clientName = t.project.clientId ? (await db.client.findUnique({ where: { id: t.project.clientId }, select: { name: true } }))?.name : null;
  const people = [...new Set([t.assigneeId, t.project.managerId, t.createdById].filter((x): x is string => !!x))];
  await notifyMany(db, people, { kind: "task.client_comment", title: `${clientName ?? "The client"} wrote on ${t.title}`, body: t.project.name, link: PROJECT_LINK(t.projectId, t.id), dedupeKey: `client-comment:${p.commentId}` });
}

// A staff comment was shared with the client: their portal users are told.
export async function commentSharedWithClient(db: Db, p: { organizationId: string; taskId: string; commentId: string; authorId: string }) {
  const t = await db.task.findFirst({ where: { id: p.taskId, clientVisible: true, project: { organizationId: p.organizationId, clientId: { not: null } } }, select: { title: true, project: { select: { id: true, name: true, clientId: true } } } });
  if (!t?.project.clientId) return;
  await notifyMany(db, await portalUsers(db, { clientId: t.project.clientId }), { kind: "task.shared_comment", title: `New message on ${t.title}`, body: t.project.name, link: `/portal/projects/${t.project.id}`, dedupeKey: `shared-comment:${p.commentId}` });
}
