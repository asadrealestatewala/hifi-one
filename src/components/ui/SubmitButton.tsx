"use client";

import { useFormStatus } from "react-dom";

// Submit button that disables itself and says so while its form is being saved, so a second click
// cannot send the form twice.
// `formAction` lets one form have two submit buttons that do different things (approve and reject), which a
// submit button's name and value cannot do reliably with server actions.
export default function SubmitButton({ children, pendingText = "Saving…", className = "btn", formAction }: { children: React.ReactNode; pendingText?: string; className?: string; formAction?: (formData: FormData) => void | Promise<void> }) {
  const { pending } = useFormStatus();
  return <button type="submit" formAction={formAction} className={className} disabled={pending} aria-disabled={pending}>{pending ? pendingText : children}</button>;
}
