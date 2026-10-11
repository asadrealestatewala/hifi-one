"use client";

import { useActionState } from "react";
import { confirmMfa, newRecoveryCodes, startMfa, turnOffMfa, type MfaState } from "./actions";

function Codes({ codes }: { codes: string[] }) {
  return (
    <div className="rounded-lg bg-green-600/10 p-3 space-y-2">
      <p className="text-sm font-semibold">Save these recovery codes now. They are shown only once.</p>
      <p className="text-xs text-muted">Each works one time if you lose your phone. Store them somewhere safe, not on the same phone.</p>
      <ul className="grid grid-cols-2 gap-1 font-mono text-sm">{codes.map((c) => <li key={c}>{c}</li>)}</ul>
    </div>
  );
}

export default function SecurityPanel({ enabled, pending, remaining }: { enabled: boolean; pending: { secret: string; qr: string } | null; remaining: number }) {
  const [startState, start, starting] = useActionState<MfaState>(startMfa, {});
  const [confirmState, confirm, confirming] = useActionState<MfaState, FormData>(confirmMfa, {});
  const [offState, turnOff, turningOff] = useActionState<MfaState, FormData>(turnOffMfa, {});
  const [codesState, regenerate, regenerating] = useActionState<MfaState, FormData>(newRecoveryCodes, {});

  if (confirmState.codes) {
    return (
      <div className="card space-y-3">
        <h2 className="font-semibold">Two-step verification is on</h2>
        <Codes codes={confirmState.codes} />
      </div>
    );
  }

  if (enabled) {
    return (
      <div className="space-y-4">
        <div className="card space-y-3">
          <h2 className="font-semibold">Two-step verification is on</h2>
          <p className="text-sm text-muted">You will be asked for a code from your authenticator app each time you sign in. Unused recovery codes: {remaining}.</p>
          {codesState.codes && <Codes codes={codesState.codes} />}
          <form action={regenerate} className="flex flex-wrap items-end gap-2">
            <div><label className="label" htmlFor="pw1">Password</label><input id="pw1" name="password" type="password" required autoComplete="current-password" className="input" /></div>
            <button className="btn-ghost" disabled={regenerating}>Make new recovery codes</button>
          </form>
          {codesState.error && <p role="alert" className="text-sm text-brand">{codesState.error}</p>}
        </div>
        <form action={turnOff} className="card flex flex-wrap items-end gap-2">
          <div className="w-full"><h2 className="font-semibold">Turn off two-step verification</h2><p className="text-xs text-muted">Not recommended, especially for administrators and finance users.</p></div>
          <div><label className="label" htmlFor="pw2">Password</label><input id="pw2" name="password" type="password" required autoComplete="current-password" className="input" /></div>
          <button className="btn-ghost" disabled={turningOff}>Turn off</button>
          {offState.error && <p role="alert" className="w-full text-sm text-brand">{offState.error}</p>}
        </form>
      </div>
    );
  }

  if (pending) {
    return (
      <form action={confirm} className="card space-y-3">
        <h2 className="font-semibold">Finish setting up</h2>
        <ol className="text-sm list-decimal pl-5 space-y-1">
          <li>Open an authenticator app (Google Authenticator, Microsoft Authenticator, Authy, 1Password…).</li>
          <li>Scan this code, or type the key by hand.</li>
          <li>Enter the 6-digit code the app shows.</li>
        </ol>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={pending.qr} alt="QR code to add Hifi One to your authenticator app" width={200} height={200} className="rounded-lg border border-border bg-white" />
        <p className="text-xs">Key: <code className="font-mono select-all">{pending.secret}</code></p>
        <div className="flex items-end gap-2">
          <div><label className="label" htmlFor="code">6-digit code</label><input id="code" name="code" required inputMode="numeric" autoComplete="one-time-code" className="input !w-40" /></div>
          <button className="btn" disabled={confirming}>Turn on</button>
        </div>
        {confirmState.error && <p role="alert" className="text-sm text-brand">{confirmState.error}</p>}
      </form>
    );
  }

  return (
    <form action={start} className="card space-y-3">
      <h2 className="font-semibold">Two-step verification is off</h2>
      <p className="text-sm text-muted">Adds a second check at sign-in using an authenticator app on your phone. Strongly recommended for anyone who can see money, salaries or settings.</p>
      <button className="btn" disabled={starting}>Set up</button>
      {startState.error && <p role="alert" className="text-sm text-brand">{startState.error}</p>}
      {offState.done && <p className="text-sm text-green-700">{offState.done}</p>}
    </form>
  );
}
