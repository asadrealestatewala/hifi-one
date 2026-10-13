"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { PERIODS, type Period } from "@/lib/dashboard-home";

// The period picker in the hero: the choice goes into the address so it survives a reload and can be shared.
export default function PeriodSelect({ value, base = "/dashboard", light = false }: { value: Period; base?: string; light?: boolean }) {
  const router = useRouter();
  const sp = useSearchParams();
  return (
    <select aria-label="Period" value={value} onChange={(e) => { const p = new URLSearchParams(sp.toString()); if (e.target.value === "month") p.delete("period"); else p.set("period", e.target.value); router.replace(`${base}${p.toString() ? `?${p}` : ""}`); }}
      className={light ? "rounded-xl border border-white/30 bg-white/15 px-3 py-2 text-sm font-medium text-white outline-none backdrop-blur focus:ring-2 focus:ring-white/40 [&>option]:text-foreground" : "input !w-auto"}>
      {(Object.keys(PERIODS) as Period[]).map((k) => <option key={k} value={k}>{PERIODS[k]}</option>)}
    </select>
  );
}
