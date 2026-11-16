"use client";

// Ticks or clears every checkbox that belongs to the given form (inputs placed anywhere on the page with form="...")
export default function SelectAll({ form, label = "Select all shown" }: { form: string; label?: string }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm">
      <input type="checkbox" onChange={(e) => document.querySelectorAll<HTMLInputElement>(`input[type=checkbox][form="${form}"][name="ids"]`).forEach((b) => { b.checked = e.target.checked; })} />
      {label}
    </label>
  );
}
