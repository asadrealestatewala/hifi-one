// Scheduled jobs: the work that used to wait for someone to press a button. Every job is idempotent (running it twice in a day
// does nothing the second time), runs once per organization per company-local day unless forced, is serialised by the database
// (one RUNNING row per job) so two servers cannot run it at once, and leaves a JobRun row saying what it did or why it failed.
// Nothing here issues invoices or posts money: billing creates DRAFT invoices and tells finance; commission accrual uses its
// existing once-per-allocation rule. Free of Next.js imports so it can be tested against the database.
import type { PrismaClient } from "@prisma/client";
import { accrueCommissions } from "./commissions";
import { formatMoney } from "./money";
import { notifyMany, usersWithPermission } from "./notifications";
import { purgeMonitoring } from "./monitoring";
import { expireContracts, expireQuotes, generateDueInvoices } from "./sales";
import { defaultStorage } from "./storage";

type Db = PrismaClient;
export type JobContext = { db: Db; organizationId: string; today: string; now: Date; actorId: string };
export type JobDef = { key: string; label: string; what: string; run: (c: JobContext) => Promise<string> };

const SYSTEM_ACTOR = "system-job";
const day = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (s: string, n: number) => day(new Date(Date.parse(`${s}T00:00:00Z`) + n * 86_400_000));
// ISO-ish week id, so a weekly reminder is sent once a week
const weekId = (s: string) => { const d = new Date(`${s}T00:00:00Z`); const j = new Date(Date.UTC(d.getUTCFullYear(), 0, 1)); return `${d.getUTCFullYear()}-W${Math.ceil(((d.getTime() - j.getTime()) / 86_400_000 + j.getUTCDay() + 1) / 7)}`; };

export const JOBS: JobDef[] = [
  {
    key: "subscription_billing", label: "Retainer billing", what: "Creates draft invoices for subscriptions that are due and tells finance to review and issue them.",
    async run({ db, organizationId, today, actorId }) {
      const made = await generateDueInvoices(db, { organizationId, today, actorId });
      if (made.length > 0) {
        await notifyMany(db, await usersWithPermission(db, organizationId, "finance.post"), { kind: "billing.drafts", title: `${made.length} retainer invoice${made.length === 1 ? "" : "s"} ready to review`, body: "Created from active subscriptions. Check and issue them.", link: "/finance/invoices?status=DRAFT", dedupeKey: `billing-drafts:${organizationId}:${today}` });
      }
      return `${made.length} draft invoice${made.length === 1 ? "" : "s"} created`;
    },
  },
  {
    key: "commission_accrual", label: "Commissions", what: "Works out commissions for payments received (once per payment), then tells the approvers.",
    async run({ db, organizationId, today, actorId }) {
      const r = await accrueCommissions(db, { organizationId, actorId });
      if (r.created > 0) await notifyMany(db, await usersWithPermission(db, organizationId, "commissions.approve"), { kind: "commission.ready", title: `${r.created} commission${r.created === 1 ? "" : "s"} waiting for approval`, link: "/finance/commissions", dedupeKey: `commission-ready:${organizationId}:${today}` });
      return `${r.created} commission${r.created === 1 ? "" : "s"} worked out`;
    },
  },
  {
    key: "expiry_sweep", label: "Quotation and contract expiry", what: "Marks sent quotations past their valid-until date as expired and active contracts past their end date as expired.",
    async run({ db, organizationId, today }) {
      const [q, c] = await Promise.all([expireQuotes(db, organizationId, today), expireContracts(db, organizationId, today)]);
      return `${q} quotation${q === 1 ? "" : "s"} and ${c} contract${c === 1 ? "" : "s"} expired`;
    },
  },
  {
    key: "invoice_reminders", label: "Invoice reminders", what: "Weekly reminder to finance and to the client about overdue invoices, and a heads-up to the client three days before an invoice is due.",
    async run({ db, organizationId, today }) {
      const open = await db.invoice.findMany({ where: { organizationId, status: { in: ["ISSUED", "PARTIALLY_PAID"] }, dueDate: { not: null } }, select: { id: true, number: true, clientId: true, total: true, amountPaid: true, creditedAmount: true, currency: true, dueDate: true, client: { select: { name: true } } } });
      const finance = await usersWithPermission(db, organizationId, "finance.view");
      const wk = weekId(today);
      let overdue = 0, soon = 0;
      const clientUsers = new Map<string, string[]>();
      const portal = async (clientId: string) => { if (!clientUsers.has(clientId)) clientUsers.set(clientId, (await db.user.findMany({ where: { clientId, active: true }, select: { id: true } })).map((u) => u.id)); return clientUsers.get(clientId)!; };
      for (const i of open) {
        const due = day(i.dueDate!);
        const owed = i.total.sub(i.amountPaid).sub(i.creditedAmount);
        if (owed.lte(0)) continue;
        if (due < today) {
          overdue++;
          const days = Math.round((Date.parse(today) - Date.parse(due)) / 86_400_000);
          await notifyMany(db, finance, { kind: "invoice.overdue", title: `Overdue: ${i.number} (${i.client.name})`, body: `${formatMoney(owed, i.currency)}, ${days} day${days === 1 ? "" : "s"} late`, link: `/finance/invoices/${i.id}`, dedupeKey: `overdue:${i.id}:${wk}` });
          await notifyMany(db, await portal(i.clientId), { kind: "invoice.overdue", title: `Invoice ${i.number} is overdue`, body: `${formatMoney(owed, i.currency)} was due on ${due}`, link: `/portal/invoices/${i.id}`, dedupeKey: `overdue-client:${i.id}:${wk}` });
        } else if (due === addDays(today, 3)) {
          soon++;
          await notifyMany(db, await portal(i.clientId), { kind: "invoice.due_soon", title: `Invoice ${i.number} is due in 3 days`, body: `${formatMoney(owed, i.currency)} due on ${due}`, link: `/portal/invoices/${i.id}`, dedupeKey: `due-soon:${i.id}` });
        }
      }
      return `${overdue} overdue invoice${overdue === 1 ? "" : "s"} reminded, ${soon} due-soon notice${soon === 1 ? "" : "s"}`;
    },
  },
  {
    key: "task_reminders", label: "Task reminders", what: "Tells people about tasks due tomorrow and tasks that became overdue today.",
    async run({ db, organizationId, today }) {
      const tomorrow = addDays(today, 1);
      const rows = await db.task.findMany({
        where: { assigneeId: { not: null }, status: { not: "DONE" }, parentId: null, dueDate: { gte: new Date(`${today}T00:00:00Z`), lt: new Date(`${addDays(today, 2)}T00:00:00Z`) }, project: { organizationId, status: { in: ["ACTIVE", "ON_HOLD"] } } },
        select: { id: true, title: true, assigneeId: true, dueDate: true, projectId: true, project: { select: { name: true } } },
      });
      const yesterdayOverdue = await db.task.findMany({ where: { assigneeId: { not: null }, status: { not: "DONE" }, parentId: null, dueDate: { gte: new Date(`${addDays(today, -1)}T00:00:00Z`), lt: new Date(`${today}T00:00:00Z`) }, project: { organizationId, status: { in: ["ACTIVE", "ON_HOLD"] } } }, select: { id: true, title: true, assigneeId: true, projectId: true, project: { select: { name: true } } } });
      let n = 0;
      for (const t of rows) {
        if (day(t.dueDate!) !== tomorrow) continue;
        n++;
        await notifyMany(db, [t.assigneeId!], { kind: "task.due_soon", title: `Due tomorrow: ${t.title}`, body: t.project.name, link: `/projects/${t.projectId}?task=${t.id}`, dedupeKey: `task-due:${t.id}` });
      }
      for (const t of yesterdayOverdue) {
        n++;
        await notifyMany(db, [t.assigneeId!], { kind: "task.overdue", title: `Now overdue: ${t.title}`, body: t.project.name, link: `/projects/${t.projectId}?task=${t.id}`, dedupeKey: `task-overdue:${t.id}` });
      }
      return `${n} task reminder${n === 1 ? "" : "s"}`;
    },
  },
  {
    key: "monitoring_purge", label: "Workfolio retention", what: "Deletes screenshots and activity records that passed the retention period in the monitoring policy.",
    async run({ db }) {
      const r = await purgeMonitoring(db, defaultStorage());
      return `${r.screenshots} screenshot${r.screenshots === 1 ? "" : "s"}, ${r.buckets} activity and ${r.appUsage} application records removed`;
    },
  },
  {
    key: "document_expiry", label: "Document expiry", what: "Warns about vendor and employee documents that expire within 30 days, and about documents that expired.",
    async run({ db, organizationId, today }) {
      const limit = addDays(today, 30);
      const files = await db.storedFile.findMany({ where: { organizationId, deletedAt: null, expiresOn: { not: null, lte: limit }, ownerType: { in: ["VENDOR_DOC", "EMPLOYEE"] } }, select: { id: true, filename: true, expiresOn: true, ownerType: true, ownerId: true, category: true } });
      const hr = await usersWithPermission(db, organizationId, "hr.view_sensitive");
      const vendorsPeople = await usersWithPermission(db, organizationId, "vendors.manage");
      let n = 0;
      for (const f of files) {
        const expired = f.expiresOn! < today;
        const milestone = expired ? "expired" : f.expiresOn! <= addDays(today, 7) ? "7" : "30";
        n++;
        const who = f.ownerType === "VENDOR_DOC" ? (await db.vendor.findUnique({ where: { id: f.ownerId }, select: { name: true } }))?.name ?? "a vendor" : (await db.user.findUnique({ where: { id: f.ownerId }, select: { name: true } }))?.name ?? "an employee";
        await notifyMany(db, f.ownerType === "VENDOR_DOC" ? vendorsPeople : hr, { kind: "document.expiry", title: expired ? `Expired: ${f.category ?? f.filename} (${who})` : `Expires ${f.expiresOn}: ${f.category ?? f.filename} (${who})`, link: f.ownerType === "VENDOR_DOC" ? `/vendors/${f.ownerId}?tab=documents` : `/hr/employees`, dedupeKey: `doc-expiry:${f.id}:${milestone}` });
      }
      return `${n} document notice${n === 1 ? "" : "s"}`;
    },
  },
];

export const jobKeys = JOBS.map((j) => j.key);

async function companyToday(db: Db, organizationId: string, now: Date) {
  const tz = (await db.companyProfile.findFirst({ where: { organizationId, isDefault: true }, select: { timezone: true } }))?.timezone ?? "UTC";
  try { return now.toLocaleDateString("en-CA", { timeZone: tz }); } catch { return day(now); }
}

export type RunOptions = { now?: Date; only?: string[]; trigger?: "SCHEDULE" | "MANUAL" | "SCRIPT"; force?: boolean; organizationId?: string; startedById?: string };
export type RunResult = { organizationId: string; key: string; status: "OK" | "FAILED" | "SKIPPED"; summary: string };

export async function runJobs(db: Db, o: RunOptions = {}): Promise<RunResult[]> {
  const now = o.now ?? new Date();
  const orgs = await db.organization.findMany({ where: o.organizationId ? { id: o.organizationId } : {}, select: { id: true } });
  const out: RunResult[] = [];
  for (const org of orgs) {
    const today = await companyToday(db, org.id, now);
    for (const job of JOBS.filter((j) => !o.only || o.only.includes(j.key))) {
      const done = await db.jobRun.findFirst({ where: { organizationId: org.id, key: job.key, runDate: today, status: "OK" } });
      if (done && !o.force) { out.push({ organizationId: org.id, key: job.key, status: "SKIPPED", summary: "Already ran today" }); continue; }
      // A run that never finished (the server stopped) must not block the job for ever
      await db.jobRun.updateMany({ where: { organizationId: org.id, key: job.key, status: "RUNNING", startedAt: { lt: new Date(now.getTime() - 30 * 60_000) } }, data: { status: "FAILED", error: "Timed out", finishedAt: now } });
      // The database allows only one RUNNING row per job and organization, so a second runner is refused here, not later
      let run;
      try { run = await db.jobRun.create({ data: { organizationId: org.id, key: job.key, trigger: o.trigger ?? "SCHEDULE", runDate: today, startedById: o.startedById ?? null } }); }
      catch (e) { if ((e as { code?: string }).code === "P2002") { out.push({ organizationId: org.id, key: job.key, status: "SKIPPED", summary: "Another run is in progress" }); continue; } throw e; }
      try {
        const summary = await job.run({ db, organizationId: org.id, today, now, actorId: o.startedById ?? SYSTEM_ACTOR });
        await db.jobRun.update({ where: { id: run.id }, data: { status: "OK", summary, finishedAt: new Date() } });
        out.push({ organizationId: org.id, key: job.key, status: "OK", summary });
      } catch (e) {
        const msg = (e instanceof Error ? e.message : "Unknown error").slice(0, 500);
        await db.jobRun.update({ where: { id: run.id }, data: { status: "FAILED", error: msg, finishedAt: new Date() } });
        out.push({ organizationId: org.id, key: job.key, status: "FAILED", summary: msg });
      }
    }
  }
  return out;
}
