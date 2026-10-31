"use client";

import { useFormStatus } from "react-dom";

// Submit button that disables itself and says so while its form is being saved, so a second click
// cannot send the form twice.
export default function SubmitButton({ children, pendingText = "Saving…", className = "btn" }: { children: React.ReactNode; pendingText?: string; className?: string }) {
  const { pending } = useFormStatus();
  return <button type="submit" className={className} disabled={pending} aria-disabled={pending}>{pending ? pendingText : children}</button>;
}
