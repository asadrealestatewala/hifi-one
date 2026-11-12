import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { dateInZone } from "@/lib/hr-rules";
import { DAY_NAMES, HOLIDAY_YEARS, getCalendar, getHolidays } from "@/lib/working-calendar";
import { Empty, Notice, PageHeader } from "@/components/ui";
import SubmitButton from "@/components/ui/SubmitButton";
import { addPakistanHolidays, addPublicHoliday, removePublicHoliday, saveWorkingCalendar } from "./actions";

export const dynamic = "force-dynamic";

const fmtHours = (m: number) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;

// The working calendar: office hours, working days and public holidays in one place. Attendance, leave, daily
// reports, scorecards, the sales quest streak, payroll and the scheduled reminders all read it.
export default async function WorkingCalendarSettings({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const user = await requirePermission("settings.company.view");
  const sp = await searchParams;
  const canEdit = user.permissions.has("settings.company.edit");
  const cal = await getCalendar(db, user.organizationId);
  const today = dateInZone(new Date(), cal.timezone);
  const holidays = await getHolidays(db, user.organizationId);
  const upcoming = holidays.filter((h) => h.date >= today);
  const past = holidays.filter((h) => h.date < today).reverse();
  return (
    <div className="max-w-3xl space-y-5">
      <PageHeader back={{ href: "/settings", label: "Settings" }}
        title="Working calendar"
        subtitle={`When the company works. Attendance, leave, daily reports, scorecards, the sales streak, payroll and the automatic reminders all read these settings, so a change here moves all of them. Times are ${cal.timezone}, set under Company settings.`}
      />
      {sp.ok && <Notice kind="ok">{sp.ok}</Notice>}
      {sp.error && <Notice kind="error">{sp.error}</Notice>}

      <form action={saveWorkingCalendar} className="card space-y-4">
        <div>
          <h2 className="font-semibold">Office hours</h2>
          <p className="text-sm text-muted">A full attendance day is the hours below less lunch, at present {fmtHours(cal.fullDayMinutes)}. The end-of-day report is written at closing time.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-4">
          <div><label className="label" htmlFor="workStart">Opens</label><input id="workStart" name="workStart" type="time" required className="input" defaultValue={cal.workStart} disabled={!canEdit} /></div>
          <div><label className="label" htmlFor="workEnd">Closes</label><input id="workEnd" name="workEnd" type="time" required className="input" defaultValue={cal.workEnd} disabled={!canEdit} /></div>
          <div><label className="label" htmlFor="lunchMinutes">Lunch (minutes)</label><input id="lunchMinutes" name="lunchMinutes" inputMode="numeric" className="input" defaultValue={cal.lunchMinutes} disabled={!canEdit} /></div>
          <div><label className="label" htmlFor="graceMinutes">Grace (minutes)</label><input id="graceMinutes" name="graceMinutes" inputMode="numeric" className="input" defaultValue={cal.graceMinutes} disabled={!canEdit} /></div>
        </div>
        <p className="text-xs text-muted">Grace is how long after opening a clock-in still counts as on time. Punctuality on the scorecard is worked out from it.</p>
        <fieldset>
          <legend className="label">Working days</legend>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {DAY_NAMES.map((name, day) => (
              <label key={name} className="flex items-center gap-2 text-sm" htmlFor={`day-${day}`}>
                <input id={`day-${day}`} type="checkbox" name="workDays" value={day} defaultChecked={cal.workDays.includes(day)} disabled={!canEdit} />
                {name}
              </label>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted">Days left unticked are the weekly off: no attendance expected, no daily report, not counted against leave.</p>
        </fieldset>
        {canEdit && <SubmitButton pendingText="Saving…">Save working hours</SubmitButton>}
      </form>

      <section className="card space-y-4">
        <div>
          <h2 className="font-semibold">Public holidays</h2>
          <p className="text-sm text-muted">A day nobody is expected to work. Leave does not count it, no daily report is expected, and no scorecard is written.</p>
        </div>
        {canEdit && (
          <>
            <form action={addPublicHoliday} className="grid gap-3 sm:grid-cols-[10rem_1fr_auto] sm:items-end">
              <div><label className="label" htmlFor="date">Date</label><input id="date" name="date" type="date" required className="input" /></div>
              <div><label className="label" htmlFor="name">What it is</label><input id="name" name="name" required className="input" placeholder="Independence Day" /></div>
              <SubmitButton pendingText="Adding…">Add holiday</SubmitButton>
            </form>
            <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3 text-sm">
              <span className="text-muted">Add Pakistan&apos;s public holidays for</span>
              {HOLIDAY_YEARS.map((year) => (
                <form key={year} action={addPakistanHolidays}>
                  <input type="hidden" name="year" value={year} />
                  <SubmitButton pendingText="Adding…" className="btn-ghost">{year}</SubmitButton>
                </form>
              ))}
              <span className="text-xs text-muted">Eid, Ashura and Milad-un-Nabi move with the moon, so they are added as expected dates. Correct them here when the government notifies them.</span>
            </div>
          </>
        )}
        {holidays.length === 0 ? (
          <Empty title="No holidays on the list">{canEdit ? "Add Pakistan's holidays with the buttons above, then correct any date that moves." : "Ask an administrator to add them."}</Empty>
        ) : (
          <div className="space-y-4">
            <div>
              <h3 className="mb-1 text-sm font-semibold text-muted">Coming up ({upcoming.length})</h3>
              {upcoming.length === 0 ? <p className="text-sm text-muted">Nothing left this year. Add next year&apos;s.</p> : (
                <ul className="divide-y divide-border">
                  {upcoming.map((h) => (
                    <li key={h.date} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                      <span><span className="font-medium">{h.date}</span> <span className="text-muted">{new Date(`${h.date}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" })}</span></span>
                      <span className="min-w-[10rem] flex-1">{h.name}</span>
                      {canEdit && <RemoveHoliday id={h.id} />}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {past.length > 0 && (
              <details>
                <summary className="cursor-pointer text-sm font-semibold text-muted">Past holidays ({past.length})</summary>
                <ul className="mt-2 divide-y divide-border">
                  {past.map((h) => (
                    <li key={h.date} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                      <span className="font-medium">{h.date}</span><span className="min-w-[10rem] flex-1">{h.name}</span>
                      {canEdit && <RemoveHoliday id={h.id} />}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </section>
    </div>
  );

}

function RemoveHoliday({ id }: { id: string }) {
  return (
    <form action={removePublicHoliday}>
      <input type="hidden" name="id" value={id} />
      <SubmitButton pendingText="Removing…" className="btn-ghost">Remove</SubmitButton>
    </form>
  );
}
