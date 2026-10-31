// Placeholder shown by a section's loading.tsx while its data loads, shaped like the screen it stands in for:
// "list" is header, figure cards, filters and a table; "board" is header and pipeline columns.
export default function PageSkeleton({ variant = "list", stats = 4, rows = 8 }: { variant?: "list" | "board"; stats?: number; rows?: number }) {
  return (
    <div className="space-y-5" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-2"><div className="skeleton h-7 w-48" /><div className="skeleton h-4 w-72 max-w-full" /></div>
        <div className="skeleton h-9 w-32" />
      </div>
      {variant === "board" ? (
        <div className="flex gap-3 overflow-hidden">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="w-64 shrink-0 space-y-2"><div className="skeleton h-6 w-32" />{[0, 1, 2].map((j) => <div key={j} className="skeleton h-20" />)}</div>
          ))}
        </div>
      ) : (
        <>
          {stats > 0 && <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{Array.from({ length: stats }, (_, i) => <div key={i} className="skeleton h-20" />)}</div>}
          <div className="flex flex-wrap gap-3"><div className="skeleton h-9 w-72 max-w-full" /><div className="skeleton h-9 w-56 max-w-full" /></div>
          <div className="card space-y-3 !p-4">{Array.from({ length: rows }, (_, i) => <div key={i} className="skeleton h-5" />)}</div>
        </>
      )}
    </div>
  );
}
