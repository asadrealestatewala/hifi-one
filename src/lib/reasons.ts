// Reasons given for destructive or financial actions (cancel, void). They go into the audit log, so they must
// say something: at least 5 characters after trimming, at most 500.
export const REASON_MIN = 5;

export function readReason(value: FormDataEntryValue | null | undefined): { ok: true; reason: string } | { ok: false; error: string } {
  const reason = typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, 500) : "";
  if (reason.length < REASON_MIN) return { ok: false, error: `Give a reason of at least ${REASON_MIN} characters.` };
  return { ok: true, reason };
}
