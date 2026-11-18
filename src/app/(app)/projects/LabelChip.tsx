import type { Label } from "@/lib/task-labels";

// One task label as a small coloured chip. The colour is a design-token tone, and the name is always written, so colour is never the only signal.
const TONE: Record<string, string> = {
  primary: "bg-primary/10 text-primary", success: "bg-success/10 text-success", warning: "bg-warning/10 text-warning",
  danger: "bg-brand/10 text-brand", info: "bg-info/10 text-info", discovery: "bg-discovery/10 text-discovery", neutral: "bg-hover text-muted",
};
export default function LabelChip({ label }: { label: Pick<Label, "name" | "color"> }) {
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${TONE[label.color] ?? TONE.neutral}`}>{label.name}</span>;
}
