"use client";

import { useActionState } from "react";
import { createFeedKeyAction, type FeedKeyState } from "./actions";

export default function FeedKeyForm({ productId, hasKey }: { productId: string; hasKey: boolean }) {
  const [state, action, pending] = useActionState<FeedKeyState, FormData>(createFeedKeyAction, {});
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="productId" value={productId} />
      <button className="btn-ghost" disabled={pending}>{pending ? "Creating…" : hasKey ? "Replace secret" : "Create secret"}</button>
      {hasKey && !state.secret && <p className="text-xs text-muted">Replacing the secret stops the Solution&rsquo;s reports until it is given the new one.</p>}
      {state.error && <p role="alert" className="text-sm text-brand">{state.error}</p>}
      {state.secret && (
        <div className="text-sm space-y-1">
          <p className="font-semibold">Secret for {state.code} (shown only once, copy it now):</p>
          <input readOnly value={state.secret} aria-label="Feed secret" className="input font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
        </div>
      )}
    </form>
  );
}
