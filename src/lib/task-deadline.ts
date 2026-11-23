// A task's deadline as one instant, and the countdown everyone sees on it. A task is due on a date (stored at 00:00 UTC)
// and optionally at a time of day in company time; with no time it is due at the end of the office day from the
// Working calendar. Pure, so the colour rules are testable without a database or a clock.
import { localToUtc } from "./social-time";
import { isTimeString } from "./working-calendar";

export type DeadlineCalendar = { timezone: string; workEnd: string };
export type CountdownTone = "green" | "orange" | "red" | "overdue";

const MIN = 60_000;
export const RED_MINUTES = 30; // the last half hour is red
export const ORANGE_MINUTES = 120; // the last two hours are at least orange...
export const ORANGE_SHARE = 0.25; // ...and so is the last quarter of the time the person was given

// "" or null clears the time; anything else must be HH:MM (24 hour).
export function readDueTime(raw: unknown): { ok: true; value: string | null } | { ok: false } {
  const v = String(raw ?? "").trim();
  if (!v) return { ok: true, value: null };
  return isTimeString(v) ? { ok: true, value: v } : { ok: false };
}

export function deadlineAt(dueDate: Date | null, dueTime: string | null | undefined, cal: DeadlineCalendar): Date | null {
  if (!dueDate) return null;
  const time = dueTime && isTimeString(dueTime) ? dueTime : cal.workEnd;
  return localToUtc(dueDate.toISOString().slice(0, 10), time, cal.timezone);
}

// "3 h 20 m", "2 days 4 h", "45 m", "under a minute"
export function spanText(ms: number): string {
  const mins = Math.floor(Math.abs(ms) / MIN);
  if (mins < 1) return "under a minute";
  const d = Math.floor(mins / 1440), h = Math.floor((mins % 1440) / 60), m = mins % 60;
  if (d > 0) return `${d} day${d === 1 ? "" : "s"}${h ? ` ${h} h` : ""}`;
  if (h > 0) return `${h} h${m ? ` ${String(m).padStart(2, "0")} m` : ""}`;
  return `${m} m`;
}

export type Countdown = { tone: CountdownTone; text: string; msLeft: number };

// `from` is when the person got the task (assigned, or created); it sets how big "the last quarter" is.
export function countdown(deadline: Date, now: Date, from?: Date | null): Countdown {
  const left = deadline.getTime() - now.getTime();
  if (left <= 0) return { tone: "overdue", text: `Overdue ${spanText(left)}`, msLeft: left };
  const total = from ? deadline.getTime() - from.getTime() : 0;
  const tone: CountdownTone = left <= RED_MINUTES * MIN ? "red"
    : left <= ORANGE_MINUTES * MIN || (total > 0 && left <= total * ORANGE_SHARE) ? "orange"
    : "green";
  return { tone, text: `${spanText(left)} left`, msLeft: left };
}

// For a finished task: did it make the deadline?
export function finishedText(deadline: Date, completedAt: Date): { onTime: boolean; text: string } {
  const diff = completedAt.getTime() - deadline.getTime();
  return diff <= 0 ? { onTime: true, text: "Done on time" } : { onTime: false, text: `Done ${spanText(diff)} late` };
}

// "Today 6:30 PM", "Tue 25 Nov, 3:00 PM" in company time
export function deadlineText(deadline: Date, timeZone: string, now = new Date()): string {
  const day = (d: Date) => d.toLocaleDateString("en-CA", { timeZone });
  const time = deadline.toLocaleTimeString("en-US", { timeZone, hour: "numeric", minute: "2-digit" });
  if (day(deadline) === day(now)) return `Today ${time}`;
  if (day(deadline) === day(new Date(now.getTime() + 86_400_000))) return `Tomorrow ${time}`;
  return `${deadline.toLocaleDateString("en-GB", { timeZone, weekday: "short", day: "numeric", month: "short" })}, ${time}`;
}

// What a screen hands to <TaskCountdown>: null when the task has no due date.
export type DeadlineView = { deadline: string; from: string | null; completedAt: string | null; title: string };
export function deadlineView(
  t: { dueDate: Date | null; dueTime?: string | null; assignedAt?: Date | null; createdAt?: Date | null; completedAt?: Date | null; status: string },
  cal: DeadlineCalendar, now = new Date(),
): DeadlineView | null {
  const at = deadlineAt(t.dueDate, t.dueTime, cal);
  if (!at) return null;
  return {
    deadline: at.toISOString(), from: (t.assignedAt ?? t.createdAt)?.toISOString() ?? null,
    completedAt: t.status === "DONE" && t.completedAt ? t.completedAt.toISOString() : null, title: deadlineText(at, cal.timezone, now),
  };
}

// The task panel's time line: when it was assigned and started, and how long it has taken so far.
export function taskTimes(
  t: { status: string; createdAt: Date; assignedAt: Date | null; startedAt: Date | null; completedAt: Date | null; assigneeId: string | null },
  timeZone: string, now = new Date(),
): { assigned: string | null; started: string | null; taken: string | null } {
  const when = (d: Date) => d.toLocaleString("en-GB", { timeZone, day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true });
  const assignedAt = t.assigneeId ? t.assignedAt ?? t.createdAt : null;
  const end = t.status === "DONE" && t.completedAt ? t.completedAt : now;
  const taken = t.startedAt ? (t.status === "DONE" ? `Took ${spanText(end.getTime() - t.startedAt.getTime())}` : `Working for ${spanText(end.getTime() - t.startedAt.getTime())}`)
    : assignedAt && t.status === "TODO" ? `Not started for ${spanText(now.getTime() - assignedAt.getTime())}` : null;
  return { assigned: assignedAt ? when(assignedAt) : null, started: t.startedAt ? when(t.startedAt) : null, taken };
}
