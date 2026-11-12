import Link from "next/link";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { markAllRead, markRead } from "@/lib/notifications";
import { Empty, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

async function readOne(formData: FormData) {
  "use server";
  const user = await requireUser();
  await markRead(db, user.id, String(formData.get("id")));
  revalidatePath("/notifications");
}

async function readAll() {
  "use server";
  const user = await requireUser();
  await markAllRead(db, user.id);
  revalidatePath("/notifications");
}

// Newest first, split into the days a person thinks in rather than one undated run.
const BUCKETS = ["Today", "Yesterday", "Earlier"] as const;
function bucketOf(when: Date, now: Date): (typeof BUCKETS)[number] {
  const day = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const days = Math.round((day(now) - day(when)) / 86_400_000);
  return days <= 0 ? "Today" : days === 1 ? "Yesterday" : "Earlier";
}

export default async function Notifications() {
  const user = await requireUser();
  const items = await db.notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 100 });
  const unread = items.filter((i) => !i.readAt).length;
  const now = new Date();
  const groups = BUCKETS.map((b) => ({ name: b, rows: items.filter((n) => bucketOf(n.createdAt, now) === b) })).filter((g) => g.rows.length > 0);
  const time = (d: Date) => d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return (
    <div className="space-y-5 max-w-3xl">
      <PageHeader
        title="Notifications"
        subtitle="Everything the system told you about, newest first. You also get an email or a phone alert for some of these."
        actions={unread > 0 ? <form action={readAll}><button className="btn-ghost">Mark all as read</button></form> : undefined}
      />
      {items.length === 0 && <Empty title="Nothing yet">When something needs you, such as a task, an approval or a decision on one of your requests, it appears here.</Empty>}
      {groups.map((g) => (
        <section key={g.name} className="space-y-2" aria-labelledby={`n-${g.name}`}>
          <h2 id={`n-${g.name}`} className="text-sm font-semibold text-muted">{g.name}</h2>
          <div className="card divide-y divide-border !p-0">
            {g.rows.map((n) => (
              <div key={n.id} className={`flex items-start justify-between gap-3 p-4 ${n.readAt ? "" : "bg-brand/5"}`}>
                <div className="text-sm">
                  <p className="font-semibold">{n.link ? <Link href={n.link} className="hover:underline">{n.title}</Link> : n.title}</p>
                  {n.body && <p className="text-muted">{n.body}</p>}
                  <p className="text-xs text-muted">{g.name === "Earlier" ? n.createdAt.toLocaleDateString() : time(n.createdAt)}</p>
                </div>
                {!n.readAt && <form action={readOne}><input type="hidden" name="id" value={n.id} /><button className="btn-ghost">Mark read</button></form>}
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
