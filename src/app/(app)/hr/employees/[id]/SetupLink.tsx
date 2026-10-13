"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/ui";
import { setupLinkAction, type LinkState } from "../actions";

// Creates a one-time link (72 hours) for the person to choose their own password. Shown once; send it yourself.
export default function SetupLink({ userId }: { userId: string }) {
  const [state, action] = useActionState<LinkState, FormData>(setupLinkAction, {});
  return (
    <form action={action} className="space-y-2 pt-1">
      <input type="hidden" name="userId" value={userId} />
      <SubmitButton className="btn-ghost !py-1" pendingText="Creating…">Create sign-in setup link</SubmitButton>
      {state.error && <p role="alert" className="text-xs text-brand">{state.error}</p>}
      {state.link && <input readOnly value={state.link} aria-label="Setup link" className="input font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />}
    </form>
  );
}
