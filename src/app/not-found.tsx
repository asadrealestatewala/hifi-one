import Link from "next/link";

// Shown for an unknown address or a record that does not exist (or is not yours to see).
export default function NotFound() {
  return (
    <main className="grid min-h-[60vh] place-items-center p-4">
      <div className="card max-w-sm space-y-3 text-center">
        <h1 className="text-lg font-semibold">Page not found</h1>
        <p className="text-sm text-muted">The address may be wrong, or the record was removed or is not available to you.</p>
        <Link href="/dashboard" className="btn inline-block">Go to the dashboard</Link>
      </div>
    </main>
  );
}
