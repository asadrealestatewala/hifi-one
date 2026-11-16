"use client";

import { useState } from "react";

type Doc = { key: string; label: string };
type Saved = { key: string; name: string; href: string }[];

// The parts of the identity form that change with the choices: which ID pictures to upload, and the business fields.
export function IdentityFields({ idTypes, documents, initial, saved, last4 }: {
  idTypes: readonly (readonly [string, string])[];
  documents: Record<string, Doc[]>;
  initial: { legalName: string; idType: string; businessName: string; ntn: string; secpNumber: string; activeTaxpayer: boolean; address: string };
  saved: Saved;
  last4: string | null;
}) {
  const [idType, setIdType] = useState(initial.idType || "CNIC");
  const [business, setBusiness] = useState(!!initial.businessName);
  const docs = documents[idType] ?? [];
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div><label className="label" htmlFor="kyc-name">Full legal name</label><input id="kyc-name" name="legalName" required maxLength={120} autoComplete="name" defaultValue={initial.legalName} className="input" /><p className="mt-1 text-xs text-muted">Exactly as printed on your ID.</p></div>
        <div><label className="label" htmlFor="kyc-type">ID type</label><select id="kyc-type" name="idType" value={idType} onChange={(e) => setIdType(e.target.value)} className="input">{idTypes.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
      </div>
      <div>
        <label className="label" htmlFor="kyc-number">ID number</label>
        <input id="kyc-number" name="idNumber" required={!last4 || idType !== initial.idType} maxLength={20} autoComplete="off" inputMode={idType === "PASSPORT" ? "text" : "numeric"} className="input" placeholder={idType === "CNIC" || idType === "NICOP" ? "35202-1234567-1" : idType === "SSN" ? "123-45-6789" : "AB1234567"} />
        <p className="mt-1 text-xs text-muted">{last4 && idType === initial.idType ? `On file: •••• ${last4}. Leave empty to keep it.` : "Stored encrypted. Only the last four characters are ever shown."}</p>
      </div>
      <fieldset className="space-y-2">
        <legend className="label">Pictures of your ID</legend>
        <p className="text-xs text-muted">Clear photo or scan, all four corners visible. JPG, PNG or PDF, up to 5 MB each.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {docs.map((d) => {
            const have = saved.find((s) => s.key === d.key);
            return (
              <div key={d.key}>
                <label className="label" htmlFor={`kyc-doc-${d.key}`}>{d.label}</label>
                <input id={`kyc-doc-${d.key}`} name={`doc_${d.key}`} type="file" accept="image/jpeg,image/png,application/pdf" required={!have} className="input" />
                {have && <p className="mt-1 text-xs text-muted">Uploaded: <a className="underline" href={have.href} target="_blank" rel="noopener">{have.name}</a>. Choose a file only to replace it.</p>}
              </div>
            );
          })}
        </div>
      </fieldset>
      <div><label className="label" htmlFor="kyc-address">Address</label><textarea id="kyc-address" name="address" required maxLength={300} rows={2} autoComplete="street-address" defaultValue={initial.address} className="input" /></div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={business} onChange={(e) => setBusiness(e.target.checked)} /> I am partnering through a registered business</label>
      {business && (
        <div className="grid gap-3 sm:grid-cols-3">
          <div><label className="label" htmlFor="kyc-biz">Registered business name</label><input id="kyc-biz" name="businessName" maxLength={160} defaultValue={initial.businessName} className="input" /></div>
          <div><label className="label" htmlFor="kyc-ntn">NTN</label><input id="kyc-ntn" name="ntn" maxLength={20} defaultValue={initial.ntn} className="input" placeholder="1234567-8" /></div>
          <div><label className="label" htmlFor="kyc-secp">SECP registration no. <span className="text-muted">(if any)</span></label><input id="kyc-secp" name="secpNumber" maxLength={30} defaultValue={initial.secpNumber} className="input" /></div>
          <label className="flex items-center gap-2 text-sm sm:col-span-3"><input type="checkbox" name="activeTaxpayer" defaultChecked={initial.activeTaxpayer} /> On FBR&rsquo;s Active Taxpayer List</label>
        </div>
      )}
    </div>
  );
}

// Payout form: the account field changes its label with the method.
export function PayoutFields({ methods, accountLabel }: { methods: readonly (readonly [string, string])[]; accountLabel: Record<string, string> }) {
  const [method, setMethod] = useState("BANK");
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div><label className="label" htmlFor="po-method">Method</label><select id="po-method" name="method" value={method} onChange={(e) => setMethod(e.target.value)} className="input">{methods.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
      {method === "BANK" && <div><label className="label" htmlFor="po-bank">Bank name</label><input id="po-bank" name="bankName" required maxLength={80} className="input" /></div>}
      {method === "OTHER" && <div><label className="label" htmlFor="po-other">Payment service</label><input id="po-other" name="otherName" required maxLength={60} className="input" placeholder="For example Payoneer or Wise" /></div>}
      <div><label className="label" htmlFor="po-title">Account title</label><input id="po-title" name="accountTitle" required maxLength={120} className="input" /><p className="mt-1 text-xs text-muted">Must match your verified name or business name, or Hifi checks it first.</p></div>
      <div><label className="label" htmlFor="po-acc">{accountLabel[method]}</label><input id="po-acc" name="account" required maxLength={60} autoComplete="off" inputMode={method === "EASYPAISA" || method === "JAZZCASH" ? "tel" : method === "PAYPAL" ? "email" : "text"} className="input" /></div>
    </div>
  );
}
