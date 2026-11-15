// The client's weekly review form: one row per part of the scope (1 to 5, or "not this week"), then the overall rating and a comment.
// Shared by the emailed link (/review/[token]) and the client portal. Plain form fields, so it works without JavaScript:
// area_0 … area_n (0 means not this week), rating, review.
const pill = "flex cursor-pointer items-center justify-center rounded-md border border-border px-2.5 py-1 text-xs has-[:checked]:border-primary has-[:checked]:bg-primary has-[:checked]:text-white has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary";

export default function ReviewAreasField({ areas, idPrefix }: { areas: string[]; idPrefix: string }) {
  return (
    <div className="space-y-4">
      {areas.length > 0 && (
        <fieldset className="space-y-1">
          <legend className="label">Rate each part of our work this week</legend>
          <p className="text-xs text-muted">5 is excellent, 1 is poor. Choose &quot;Not this week&quot; when it did not apply.</p>
          <ul className="divide-y divide-border">
            {areas.map((a, i) => (
              <li key={a} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span id={`${idPrefix}-a${i}`} className="text-sm">{a}</span>
                <span role="radiogroup" aria-labelledby={`${idPrefix}-a${i}`} className="flex flex-wrap gap-1">
                  {[5, 4, 3, 2, 1].map((n) => <label key={n} className={pill}><input type="radio" name={`area_${i}`} value={n} required className="sr-only" /><span>{n}<span aria-hidden> ★</span></span></label>)}
                  <label className={pill}><input type="radio" name={`area_${i}`} value={0} required className="sr-only" />Not this week</label>
                </span>
              </li>
            ))}
          </ul>
        </fieldset>
      )}
      <fieldset className="space-y-2">
        <legend className="label">Overall, how was the week?</legend>
        <div className="flex flex-wrap gap-2">
          {[5, 4, 3, 2, 1].map((n) => (
            <label key={n} className="flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm has-[:checked]:border-primary has-[:checked]:bg-hover">
              <input type="radio" name="rating" value={n} required />
              <span aria-hidden>{"★".repeat(n)}</span><span className="sr-only">{n} of 5</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div><label className="label" htmlFor={`${idPrefix}-review`}>What went well, and what should we improve?</label><textarea id={`${idPrefix}-review`} name="review" required minLength={3} maxLength={2000} rows={4} className="input" /></div>
    </div>
  );
}

// Reads the area answers back from the submitted form, in order.
export const readAreaRatings = (formData: FormData) => Array.from({ length: 15 }, (_, i) => String(formData.get(`area_${i}`) ?? ""));

// The stored answers, compact: "Reels and short videos 5★ · Paid ads 3★". Areas marked "not this week" are left out.
export function AreaList({ areas }: { areas: unknown }) {
  const rows = Array.isArray(areas) ? (areas as { area?: unknown; rating?: unknown }[]).filter((a) => typeof a.area === "string" && typeof a.rating === "number") as { area: string; rating: number }[] : [];
  if (rows.length === 0) return null;
  return <ul className="my-1 flex flex-wrap gap-x-3 gap-y-1 text-xs">{rows.map((a) => <li key={a.area}><span className="text-muted">{a.area}</span> <strong className={a.rating <= 3 ? "text-brand" : ""}>{a.rating}★</strong></li>)}</ul>;
}
