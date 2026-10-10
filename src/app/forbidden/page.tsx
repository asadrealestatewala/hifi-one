import Link from "next/link";

export default function Forbidden() {
  return (
    <main className="min-h-screen grid place-items-center p-4">
      <div className="card max-w-sm text-center space-y-3">
        <h1 className="text-lg font-bold">Access denied</h1>
        <p className="text-sm text-muted">Your role does not include permission to open this page.</p>
        <Link href="/dashboard" className="btn inline-block">Back to dashboard</Link>
      </div>
    </main>
  );
}
