// Pure period-lock rule. A lock date means nothing may be posted on or before that day.
export function periodLockMessage(lockedThrough: string | null | undefined, date: Date): string | null {
  if (!lockedThrough) return null;
  const day = date.toISOString().slice(0, 10);
  return day <= lockedThrough ? `This period is closed through ${lockedThrough}. Post the entry in an open period, or ask for the period to be reopened.` : null;
}
