import { randomUUID } from "node:crypto";
import { refundAction } from "./refund";

export default function RefundForm({ clientId, banks, currency, held }: { clientId: string; banks: { id: string; name: string }[]; currency: string; held: string }) {
  return (
    <form action={refundAction} className="card flex flex-wrap items-end gap-3 max-w-3xl">
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="key" value={randomUUID()} />
      <div className="w-full"><h2 className="font-semibold">Refund money held on account</h2><p className="text-xs text-muted">The client holds {held} {currency}. A refund cannot exceed it.</p></div>
      <div><label className="label" htmlFor={`rb${currency}`}>Pay from</label>
        <select id={`rb${currency}`} name="bankAccountId" required className="input"><option value="">Choose…</option>{banks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></div>
      <div><label className="label" htmlFor={`ra${currency}`}>Amount ({currency})</label><input id={`ra${currency}`} name="amount" required inputMode="decimal" className="input !w-36" /></div>
      <div className="flex-1 min-w-48"><label className="label" htmlFor={`rr${currency}`}>Reason</label><input id={`rr${currency}`} name="reason" required className="input" /></div>
      <button className="btn">Refund</button>
    </form>
  );
}
