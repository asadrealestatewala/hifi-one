// Shared form pieces for the Partner Stack screens (plain markup, no client code).
export const DURATION_CHOICES = [["lifetime", "Lifetime (as long as the client keeps paying)"], ["36", "3 years"], ["12", "1 year"], ["custom", "Custom number of months"]] as const;

export function choiceFor(months: number | null | undefined): { choice: string; custom: string } {
  if (months == null) return { choice: "lifetime", custom: "" };
  if (months === 36 || months === 12) return { choice: String(months), custom: "" };
  return { choice: "custom", custom: String(months) };
}

// The value the services expect: "" or "lifetime" for lifetime, otherwise a number of months.
export function readDuration(f: FormData): string {
  const c = String(f.get("durationChoice") ?? "lifetime");
  return c === "custom" ? String(f.get("durationCustom") ?? "").trim() : c;
}

export function DurationFields({ idPrefix, months }: { idPrefix: string; months: number | null | undefined }) {
  const { choice, custom } = choiceFor(months);
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div><label className="label" htmlFor={`${idPrefix}-dur`}>Commission duration</label>
        <select id={`${idPrefix}-dur`} name="durationChoice" defaultValue={choice} className="input">{DURATION_CHOICES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
      <div><label className="label" htmlFor={`${idPrefix}-months`}>Custom months</label>
        <input id={`${idPrefix}-months`} name="durationCustom" type="number" min={1} max={600} defaultValue={custom} className="input" placeholder="Only for custom" /></div>
    </div>
  );
}
