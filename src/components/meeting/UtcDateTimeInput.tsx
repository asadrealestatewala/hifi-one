"use client";

import { useState } from "react";

// A date and time picker in the person's own time zone that submits an exact UTC instant, so a meeting means the same
// moment for everyone wherever the server runs.
export default function UtcDateTimeInput({ name, label, id }: { name: string; label: string; id: string }) {
  const [iso, setIso] = useState("");
  return (
    <div>
      <label className="label" htmlFor={id}>{label}</label>
      <input id={id} type="datetime-local" className="input" onChange={(e) => { const d = e.target.value ? new Date(e.target.value) : null; setIso(d && !Number.isNaN(d.getTime()) ? d.toISOString() : ""); }} />
      <input type="hidden" name={name} value={iso} />
    </div>
  );
}
