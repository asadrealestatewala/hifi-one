import Link from "next/link";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { markAllRead, markRead } from "@/lib/notifications";

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

export default async function Notifications() {
  const user = await requireUser();
  const items = await db.notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 100 });
  const unread = items.filter((i) => !i.readAt).length;
  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Notifications</h1>
        {unread > 0 && <form action={readAll}><button className="btn-ghost">Mark all as read</button></form>}
      </div>
      <p className="text-xs text-muted">In-app only for now. Email, WhatsApp and browser push need provider setup, and per-type preferences are not built yet.</p>
      <div className="card divide-y divide-border !p-0">
        {items.length === 0 && <p className="p-4 text-sm text-muted">Nothing yet.</p>}
        {items.map((n) => (
          <div key={n.id} className={`flex items-start justify-between gap-3 p-4 ${n.readAt ? "" : "bg-brand/5"}`}>
            <div className="text-sm">
              <p className="font-semibold">{n.link ? <Link href={n.link} className="hover:underline">{n.title}</Link> : n.title}</p>
              {n.body && <p className="text-muted">{n.body}</p>}
              <p className="text-xs text-muted">{n.createdAt.toLocaleString()}</p>
            </div>
            {!n.readAt && <form action={readOne}><input type="hidden" name="id" value={n.id} /><button className="btn-ghost">Mark read</button></form>}
          </div>
        ))}
      </div>
    </div>
  );
}
