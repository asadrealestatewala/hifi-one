import Icon from "@/components/shell/Icon";
import { RECORD, type RecordType } from "@/lib/tint";

// The fixed icon tile for a record type (see RECORD in src/lib/tint.ts). Decorative: the record's name or label sits beside it.
export default function RecordIcon({ type, size = "md", fallback = "bell" }: { type: RecordType | null; size?: "sm" | "md" | "lg"; fallback?: string }) {
  const r = type ? RECORD[type] : null;
  const box = size === "sm" ? "h-6 w-6 rounded-md" : size === "lg" ? "h-10 w-10 rounded-xl" : "h-8 w-8 rounded-lg";
  const ic = size === "sm" ? "h-3.5 w-3.5" : size === "lg" ? "h-5 w-5" : "h-4 w-4";
  const tone = r?.tone ?? "slate";
  return (
    <span aria-hidden="true" className={`grid shrink-0 place-items-center ${box}`} style={{ background: `color-mix(in srgb, var(--tint-${tone}) 14%, transparent)`, color: `var(--tint-${tone})` }}>
      <Icon name={r?.icon ?? fallback} className={ic} />
    </span>
  );
}
