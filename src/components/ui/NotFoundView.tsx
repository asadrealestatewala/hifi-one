import Link from "next/link";

// Shown by the not-found.tsx files when a record does not exist or is outside the person's scope.
// It never says which: "removed" and "not yours" look the same, so the page leaks nothing.
export default function NotFoundView({ home, homeLabel }: { home: string; homeLabel: string }) {
  return (
    <div className="card mx-auto my-10 max-w-sm space-y-3 text-center">
      <h1 className="text-lg font-semibold">Not found</h1>
      <p className="text-sm text-muted">This page or record does not exist, was removed, or is not available to you.</p>
      <Link href={home} className="btn inline-block">{homeLabel}</Link>
    </div>
  );
}
