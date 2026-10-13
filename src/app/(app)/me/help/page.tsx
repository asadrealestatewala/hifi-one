import Link from "next/link";
import { requireUser } from "@/lib/auth";
import type { PermissionKey } from "@/lib/permissions";
import { PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

type Task = { title: string; why: string; href: string; permission: PermissionKey | null };

// Common jobs, each linking to the place it is done. Only the ones this person's role allows are shown.
const TASKS: Task[] = [
  { title: "Add a lead or contact", why: "Everyone you deal with lives in Contacts; a lead is its sales opportunity.", href: "/leads?new=1", permission: "crm.edit" },
  { title: "Log a call or note", why: "Open the contact and use the activity box. Connected calls count toward your target once a manager verifies them.", href: "/contacts", permission: "crm.edit" },
  { title: "Send a quotation", why: "Pick plans from the service catalog, save as a draft, then mark it sent.", href: "/quotes?new=1", permission: "quotes.manage" },
  { title: "Create an invoice", why: "Totals update as you type. It is a draft until you issue it; nothing posts to the books before that.", href: "/finance/invoices?new=1", permission: "finance.post" },
  { title: "Record a payment you received", why: "It is applied to the oldest open invoices first; any extra is kept as an advance.", href: "/finance/payments?new=1", permission: "finance.post" },
  { title: "Submit an expense voucher", why: "Attach the receipt. It goes to review and approval before it is paid.", href: "/expenses", permission: "self.expense" },
  { title: "Mark your attendance", why: "Clock in, take breaks and clock out. A session left open is corrected by HR with a reason.", href: "/me/attendance", permission: "self.attendance" },
  { title: "Ask for leave", why: "Your balance is shown before you send the request; your manager approves it.", href: "/me/leave", permission: "self.leave" },
  { title: "See and update your tasks", why: "Everything assigned to you across projects, with due dates.", href: "/me/tasks", permission: null },
  { title: "Plan a social-media post", why: "Choose platforms, date and time; attach the creative; send it for approval.", href: "/content?new=1", permission: "content.manage" },
  { title: "Start a video meeting", why: "Share a guest link with a client; admit them from the waiting room.", href: "/meetings", permission: "meetings.use" },
  { title: "Ask the assistant", why: "Questions about your data, answered from what you are allowed to see.", href: "/assistant", permission: "assistant.use" },
];

const TIPS: [string, string][] = [
  ["Jump anywhere", "Press Ctrl K (or Cmd K) to search clients, leads, invoices and more."],
  ["Panels", "New records open in a panel on the right. Press Esc to close it without saving."],
  ["Filters", "Chips and filters change the address of the page, so you can bookmark or share the exact view."],
  ["Rows", "Click anywhere on a table row to open that record."],
  ["Your picture", "Add one under My Profile; colleagues see it next to your name."],
  ["Two-step sign-in", "Switch it on under Account Security. Some roles are required to have it."],
];

export default async function Help() {
  const user = await requireUser();
  const mine = TASKS.filter((t) => t.permission === null || user.permissions.has(t.permission));
  return (
    <div className="space-y-6">
      <PageHeader title="Help & guide" subtitle="Where to do the common jobs, and a few tips. You only see what your role allows." />
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {mine.map((t) => (
          <Link key={t.title} href={t.href} className="card block !p-4 transition hover:ring-2 hover:ring-primary/30"><p className="font-semibold">{t.title}</p><p className="mt-1 text-sm text-muted">{t.why}</p></Link>
        ))}
      </section>
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
