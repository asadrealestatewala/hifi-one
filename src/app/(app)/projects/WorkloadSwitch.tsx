import Link from "next/link";

// The two halves of Workload: what is coming (next 7 days) and what happened (hours report).
export default function WorkloadSwitch({ current }: { current: "next" | "hours" }) {
  const items = [{ key: "next", label: "Next 7 days", href: "/projects?view=workload" }, { key: "hours", label: "Hours report", href: "/projects?view=workload&report=hours" }] as const;
  return (
    <nav aria-label="Workload" className="inline-flex rounded-lg border border-border p-0.5 text-sm">
      {items.map((i) => <Link key={i.key} href={i.href} aria-current={i.key === current ? "page" : undefined} className={`rounded-md px-3 py-1 ${i.key === current ? "bg-hover font-medium text-foreground" : "text-muted hover:text-foreground"}`}>{i.label}</Link>)}
    </nav>
  );
}
