import Link from "next/link";
import { requireUser } from "@/lib/auth";
import type { PermissionKey } from "@/lib/permissions";
import { PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

type Group = "day" | "sales" | "clients" | "work" | "people" | "admin";
type Task = { title: string; why: string; href: string; permission: PermissionKey | null; group: Group };

const GROUPS: [Group, string][] = [
  ["day", "Your day"],
  ["sales", "Selling"],
  ["clients", "Clients and money"],
  ["work", "Projects and content"],
  ["people", "People and HR"],
  ["admin", "Running the system"],
];

// Common jobs, each linking to the place it is done. Only the ones this person's role allows are shown.
// Keep this list in step with the menu: a feature that is not here is a feature nobody finds.
const TASKS: Task[] = [
  // Your day
  { group: "day", title: "Clock in and out", why: "One button starts your attendance for the day, and the activity tracker with it if your company uses one. Breaks and clock out are on the same page.", href: "/me/attendance", permission: "self.attendance" },
  { group: "day", title: "Write your daily report", why: "A short note at the end of each working day: what you did, anything blocking you, and your plan. Your manager and HR read it.", href: "/me/report", permission: "self.attendance" },
  { group: "day", title: "See your score for the day", why: "Attendance, punctuality, your report and your output against target, worked out each evening after office hours.", href: "/me/scorecard", permission: "self.attendance" },
  { group: "day", title: "See and update your tasks", why: "Everything assigned to you across projects and campaigns, with due dates.", href: "/me/tasks", permission: null },
  { group: "day", title: "Read circulars", why: "Notices from HR and management addressed to you. Some ask you to confirm you have read them.", href: "/me/circulars", permission: null },
  { group: "day", title: "See what is recorded about you", why: "Your hours, activity, who has looked at your data, and how to ask for a day to be corrected.", href: "/me/time", permission: "monitoring.own" },
  { group: "day", title: "Message a colleague", why: "Direct messages, group chats and project rooms, with calls.", href: "/chat", permission: "chat.use" },
  { group: "day", title: "Ask the assistant", why: "Questions about your data, answered from what you are allowed to see.", href: "/assistant", permission: "assistant.use" },

  // Selling
  { group: "sales", title: "Add a lead or contact", why: "Everyone you deal with lives in Contacts; a lead is its sales opportunity.", href: "/leads?new=1", permission: "crm.edit" },
  { group: "sales", title: "Log a call or note", why: "Open the contact and use the activity box. Connected calls count toward your target once a manager verifies them.", href: "/contacts", permission: "crm.edit" },
  { group: "sales", title: "Work your prospect list", why: "Businesses to approach for the software line you are on. Claim one, call it, and log what happened.", href: "/leads/prospector/mine", permission: "crm.edit" },
  { group: "sales", title: "Log a field visit", why: "For agents who visit businesses in person. Works without a signal and sends when you are back online.", href: "/field", permission: "field.capture" },
  { group: "sales", title: "Book a demo", why: "Hand a warm prospect to the demo team, with the time the owner agreed.", href: "/leads/prospector/demos", permission: "prospector.schedule_demo" },
  { group: "sales", title: "Send a quotation", why: "Pick plans from the service catalog, save as a draft, then mark it sent.", href: "/quotes?new=1", permission: "quotes.manage" },
  { group: "sales", title: "Check your targets", why: "Calls, visits and conversions against what is expected of you this month.", href: "/sales/activity", permission: "crm.view" },
  { group: "sales", title: "See your commissions", why: "What you have earned, what is approved, and what has been paid with your salary.", href: "/me/commissions", permission: "commissions.own" },

  // Clients and money
  { group: "clients", title: "Create an invoice", why: "Totals update as you type. It is a draft until you issue it; nothing posts to the books before that.", href: "/finance/invoices?new=1", permission: "finance.post" },
  { group: "clients", title: "Record a payment you received", why: "It is applied to the oldest open invoices first; any extra is kept as an advance.", href: "/finance/payments?new=1", permission: "finance.post" },
  { group: "clients", title: "Give a client portal access", why: "Open the client, then Portal access. It makes a one-time invitation link you send them.", href: "/clients", permission: "clients.edit" },
  { group: "clients", title: "Answer a support request", why: "What clients have raised, who owns it, and what was promised.", href: "/support", permission: "support.view" },
  { group: "clients", title: "Submit an expense voucher", why: "Attach the receipt. It goes to review and approval before it is paid.", href: "/expenses", permission: "self.expense" },

  // Projects and content
  { group: "work", title: "Open a project", why: "Tasks, milestones, time, files and what the client can see.", href: "/projects", permission: "projects.view" },
  { group: "work", title: "Share a file with a client", why: "Project files with folders, versions and a link that works without a login.", href: "/projects", permission: "projects.view" },
  { group: "work", title: "Plan a social-media post", why: "Choose platforms, date and time; attach the creative; send it for approval.", href: "/content?new=1", permission: "content.manage" },
  { group: "work", title: "Start a video meeting", why: "Share a guest link with a client; admit them from the waiting room.", href: "/meetings", permission: "meetings.use" },

  // People and HR
  { group: "people", title: "Ask for leave", why: "Your balance is shown before you send the request; your manager approves it.", href: "/me/leave", permission: "self.leave" },
  { group: "people", title: "Tell us you are working off-site", why: "A client visit, field work or a day working from home. Approved days show on your attendance.", href: "/me/visits", permission: "self.attendance" },
  { group: "people", title: "Ask HR for something", why: "A salary or experience certificate, an advance, a resignation, a complaint, equipment. Anything without a form of its own.", href: "/me/requests", permission: "self.leave" },
  { group: "people", title: "Upload a document HR asked for", why: "Identity, certificates, contracts, health papers. Only you and authorised HR staff can see them.", href: "/me/documents", permission: "self.leave" },
  { group: "people", title: "Get your payslip", why: "Every month you have been paid for, as a PDF.", href: "/me/payslips", permission: "self.payslip" },
  { group: "people", title: "Decide leave and off-site requests", why: "What your direct reports have asked for, with their balance beside it.", href: "/me/leave", permission: "leave.approve" },
  { group: "people", title: "Read the team's daily reports", why: "Who sent one, who is missing, and the day's attendance and tasks beside it.", href: "/hr/reports", permission: "leave.approve" },
  { group: "people", title: "Send a circular", why: "A notice to everyone or to chosen people, with attachments, and a list of who has read it.", href: "/hr/circulars", permission: "circulars.send" },
  { group: "people", title: "Add a member of staff", why: "Creates their record and their sign-in, and sends them an onboarding code.", href: "/hr/employees", permission: "hr.manage" },

  // Running the system
  { group: "admin", title: "Change what a role can do", why: "Permissions per role. Everyone with that role is affected at their next sign-in.", href: "/roles", permission: "roles.manage" },
  { group: "admin", title: "Set up email", why: "The address your system sends from, and the wording of each automatic email.", href: "/settings/email", permission: "settings.company.view" },
  { group: "admin", title: "Set the monitoring policy", why: "What is recorded, for whom, and how long it is kept. Staff accept it before anything is recorded.", href: "/settings/monitoring", permission: "monitoring.configure" },
  { group: "admin", title: "Check the scheduled jobs", why: "Billing, reminders, the end-of-day report and the nightly clean-up, with when each last ran.", href: "/settings/jobs", permission: "jobs.run" },
];

const TIPS: [string, string][] = [
  ["Jump anywhere", "Press Ctrl K (or Cmd K) to search clients, leads, invoices and more."],
  ["Panels", "New records open in a panel on the right. Press Esc to close it without saving."],
  ["Filters", "Chips and filters change the address of the page, so you can bookmark or share the exact view."],
  ["Rows", "Click anywhere on a table row to open that record."],
  ["Your menu", "Customize menu, at the bottom of the sidebar, lets you reorder or hide groups and pick their colours."],
  ["On your phone", "Every screen works on a phone, and there is an app for Android under My account."],
  ["Your picture", "Add one under My profile; colleagues see it next to your name."],
  ["Two-step sign-in", "Switch it on under Account security. Some roles are required to have it."],
];

export default async function Help() {
  const user = await requireUser();
  const mine = TASKS.filter((t) => t.permission === null || user.permissions.has(t.permission));
  const groups = GROUPS.map(([id, title]) => ({ id, title, items: mine.filter((t) => t.group === id) })).filter((g) => g.items.length > 0);
  return (
    <div className="space-y-6">
      <PageHeader title="Help & guide" subtitle="Where to do the common jobs, and a few tips. You only see what your role allows." />
      {groups.map((g) => (
        <section key={g.id} className="space-y-3" aria-labelledby={`help-${g.id}`}>
          <h2 id={`help-${g.id}`} className="font-semibold">{g.title}</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {g.items.map((t) => (
              <Link key={t.title} href={t.href} className="card block !p-4 transition hover:ring-2 hover:ring-primary/30"><p className="font-semibold">{t.title}</p><p className="mt-1 text-sm text-muted">{t.why}</p></Link>
            ))}
          </div>
        </section>
      ))}
      <section className="card">
        <h2 className="mb-3 font-semibold">Good to know</h2>
        <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2">{TIPS.map(([k, v]) => <div key={k}><dt className="text-sm font-medium">{k}</dt><dd className="text-sm text-muted">{v}</dd></div>)}</dl>
      </section>
      <section className="card text-sm text-muted">
        <h2 className="mb-1 font-semibold text-foreground">Something not working?</h2>
        <p>If a page says you do not have access, your role does not include it; ask your manager or an administrator. If something looks wrong, note the page address and what you clicked, and tell your administrator.</p>
        <p className="mt-2">Your account: {user.name}, {user.roles.join(", ")}. <Link href="/account/security" className="text-primary hover:underline">Account security</Link> · <Link href="/me/profile" className="text-primary hover:underline">My profile</Link></p>
      </section>
    </div>
  );
}
