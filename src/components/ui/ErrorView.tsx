"use client";

import Link from "next/link";
import { useEffect } from "react";

// Shown by the error.tsx files when a screen fails to load. It never shows the error itself (it may hold
// internal details); the reference code lets an administrator find the matching server log line.
export default function ErrorView({ error, reset, home }: { error: Error & { digest?: string }; reset: () => void; home: string }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <div role="alert" className="card mx-auto my-10 max-w-md space-y-3 text-center">
      <h1 className="text-lg font-semibold">This page could not be loaded</h1>
      <p className="text-sm text-muted">Nothing was changed. Try again; if it keeps happening, tell an administrator{error.digest ? <> and quote reference <span className="font-mono">{error.digest}</span></> : null}.</p>
      <div className="flex justify-center gap-2">
        <button type="button" className="btn" onClick={reset}>Try again</button>
        <Link href={home} className="btn-ghost">Go to the start page</Link>
      </div>
    </div>
  );
}
