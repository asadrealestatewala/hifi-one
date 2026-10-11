import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { audit, requirePermission } from "@/lib/auth";
import { setCalendarToken } from "@/lib/calendar";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

async function change(formData: FormData) {
  "use server";
  const user = await requirePermission("self.leave");
  const mode = String(formData.get("mode"));
  if (!["create", "rotate", "off"].includes(mode)) redirect("/me/calendar");
  await setCalendarToken(db, user.id, mode as "create" | "rotate" | "off");
  await audit(user, { action: `calendar.${mode}`, entity: "User", entityId: user.id });
  redirect("/me/calendar");
}

export default async function MyCalendar() {
  const user = await requirePermission("self.leave");
  const row = await db.user.findUniqueOrThrow({ where: { id: user.id }, select: { calendarToken: true } });
  const h = await headers();
  const base = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000"}`;
  const url = row.calendarToken ? `${base}/api/calendar/${row.calendarToken}.ics` : null;
  return (
    <div className="space-y-4 max-w-2xl">
      <h1 className="text-2xl font-semibold tracking-tight">My calendar</h1>
      <p className="text-sm text-muted">Subscribe in Google Calendar, Outlook or Apple Calendar to see your task deadlines, leave, lead follow-ups, projects you manage and (if your role can view them) contract end dates and planned content posts, next to your other events. It is read-only and updates itself.</p>
      {url ? (
        <section className="card space-y-3">
          <p className="text-sm">Your private calendar address:</p>
          <input readOnly value={url} aria-label="Calendar address" className="input font-mono text-xs" />
          <p className="text-xs text-muted">Anyone who has this address can see these entries, so treat it like a password. If it leaks, replace it: the old address stops working immediately. In Google Calendar choose Other calendars, then From URL; in Outlook choose Add calendar, then Subscribe from web.</p>
          <div className="flex gap-2">
            <form action={change}><input type="hidden" name="mode" value="rotate" /><button className="btn-ghost">Replace address</button></form>
            <form action={change}><input type="hidden" name="mode" value="off" /><button className="btn-ghost">Switch off</button></form>
          </div>
        </section>
      ) : (
        <section className="card space-y-2"><p className="text-sm text-muted">Your calendar feed is switched off.</p><form action={change}><input type="hidden" name="mode" value="create" /><button className="btn">Create my calendar address</button></form></section>
      )}
    </div>
  );
}
