import { emailDocumentAction } from "@/app/email/actions";

// "Email this to the client" with the recipient prefilled from the client record. Shows a banner for the last result.
export default function EmailDocForm({ kind, id, defaultTo, returnTo, flash, label = "Email to client" }: {
  kind: "INVOICE" | "QUOTE" | "STATEMENT"; id: string; defaultTo?: string | null; returnTo: string; flash?: { mailOk?: string; mailError?: string }; label?: string;
}) {
  return (
    <div className="space-y-2 print:hidden">
      {flash?.mailOk && <p className="text-sm bg-green-600/10 text-green-700 rounded-lg px-3 py-2">{flash.mailOk}</p>}
      {flash?.mailError && <p role="alert" className="text-sm text-brand bg-brand/10 rounded-lg px-3 py-2">{flash.mailError}</p>}
      <form action={emailDocumentAction} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="kind" value={kind} /><input type="hidden" name="id" value={id} /><input type="hidden" name="returnTo" value={returnTo} />
        <div><label className="label" htmlFor={`to-${kind}`}>{label} (PDF attached)</label><input id={`to-${kind}`} name="to" type="email" required defaultValue={defaultTo ?? ""} placeholder="client@example.com" className="input !w-72" /></div>
        <button className="btn-ghost">Send email</button>
      </form>
    </div>
  );
}
