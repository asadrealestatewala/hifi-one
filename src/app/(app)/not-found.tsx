import Link from "next/link";

// Shown inside the staff shell when a record does not exist or is outside the person's scope.
export default function NotFound() {
  return (
    <div className="card mx-auto my-10 max-w-sm space-y-3 text-center">
      <h1 className="text-lg font-semibold">Not found</h1>
      <p className="text-sm text-muted">This record does not exist, was removed, or is not available to you.</p>
      <Link href="/dashboard" className="btn inline-block">Back to the dashboard</Link>
    </div>
  );
}
