import Link from "next/link";
import { revalidatePath } from "next/cache";
import { requireVendorUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { markAllRead, markRead } from "@/lib/notifications";
import { Empty, PageHeader, SubmitButton } from "@/components/ui";

export const dynamic = "force-dynamic";

async function readOne(formData: FormData) {
  "use server";
  const user = await requireVendorUser();
  await markRead(db, user.id, String(formData.get("id")));
  revalidatePath("/vendor/notifications");
}

async function readAll() {
  "use server";
  const user = await requireVendorUser();
  await markAllRead(db, user.id);
  revalidatePath("/vendor/notifications");
}

// The person's own messages only (the query is by the signed-in user's id).
export default async function Notifications() {
  const user = await requireVendorUser();
  const items = await db.notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 50 });
  const unread = items.filter((i) => !i.readAt).length;
  return (
    <div className="max-w-3xl space-y-4">
      <PageHeader title="Notifications" subtitle="Updates from the Hifi team about your work." actions={unread > 0 ? <form action={readAll}><SubmitButton className="btn-ghost" pendingText="Saving…">Mark all as read</SubmitButton></form> : undefined} />
      {items.length === 0 ? <Empty title="Nothing yet">New messages appear here.</Empty> : (
        <div className="card divide-y divide-border !p-0">
          {items.map((n) => (
            <div key={n.id} className={`flex items-start justify-between gap-3 p-4 ${n.readAt ? "" : "bg-primary/5"}`}>
              <div className="text-sm">
                <p className="font-semibold">{n.link && n.link.startsWith("/vendor") ? <Link href={n.link} className="hover:underline">{n.title}</Link> : n.title}</p>
                {n.body && <p className="text-muted">{n.body}</p>}
                <p className="text-xs text-muted">{n.createdAt.toLocaleString()}</p>
              </div>
              {!n.readAt && <form action={readOne}><input type="hidden" name="id" value={n.id} /><SubmitButton className="btn-ghost" pendingText="…">Mark read</SubmitButton></form>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
