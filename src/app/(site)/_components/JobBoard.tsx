"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Icon } from "./Icon";

type JobRow = { id: number; title: string; department: string; location: string; type: string; workplace: string | null };
const ALL = "";
const options = (rows: JobRow[], key: keyof JobRow) => [...new Set(rows.map((r) => r[key]).filter((v): v is string => typeof v === "string" && v !== ""))].sort();

// The job list with search and filters. Every role is in the HTML from the server, so the list works without JavaScript too.
export function JobBoard({ jobs }: { jobs: JobRow[] }) {
  const [q, setQ] = useState("");
  const [department, setDepartment] = useState(ALL);
  const [type, setType] = useState(ALL);
  const [workplace, setWorkplace] = useState(ALL);
  const [location, setLocation] = useState(ALL);

  const shown = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return jobs.filter((j) =>
      (!department || j.department === department) && (!type || j.type === type) && (!workplace || j.workplace === workplace) && (!location || j.location === location) &&
      words.every((w) => `${j.title} ${j.department} ${j.location}`.toLowerCase().includes(w)),
    );
  }, [jobs, q, department, type, workplace, location]);

  const filtered = q || department || type || workplace || location;
  const reset = () => { setQ(""); setDepartment(ALL); setType(ALL); setWorkplace(ALL); setLocation(ALL); };

  const select = (id: string, label: string, value: string, set: (v: string) => void, key: keyof JobRow, all: string) => (
    <div className="hs-field">
      <label htmlFor={id}>{label}</label>
      <select id={id} className="hs-input" value={value} onChange={(e) => set(e.target.value)}>
        <option value={ALL}>{all}</option>
        {options(jobs, key).map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );

  return (
    <div>
      <div className="hs-filters" role="search">
        <div className="hs-field">
          <label htmlFor="job-q">Search roles</label>
          <input id="job-q" className="hs-input" type="search" placeholder="e.g. Python, designer, ads" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {select("job-dept", "Department", department, setDepartment, "department", "All departments")}
        {select("job-type", "Type", type, setType, "type", "All types")}
        {select("job-work", "Workplace", workplace, setWorkplace, "workplace", "Any workplace")}
        {select("job-loc", "Location", location, setLocation, "location", "All locations")}
      </div>
      <p aria-live="polite" className="hs-muted" style={{ margin: "0 0 16px", fontWeight: 600 }}>
        {shown.length} {shown.length === 1 ? "role" : "roles"}{filtered ? " match your filters" : " open"}
        {filtered && <> &middot; <button type="button" onClick={reset} className="hs-link" style={{ background: "none", border: 0, cursor: "pointer", font: "inherit", padding: 0 }}>Clear filters</button></>}
      </p>
      {shown.length === 0 ? (
        <div className="hs-empty">
          <h3>No roles match those filters</h3>
          <p>Try fewer filters, or send us your CV through the contact page and we will keep it on file.</p>
          <div className="hs-actions" style={{ justifyContent: "center", marginTop: 16 }}>
            <button type="button" className="hs-btn hs-btn-ghost" onClick={reset}>Clear filters</button>
            <Link href="/site/contact" className="hs-btn">Contact us</Link>
          </div>
        </div>
      ) : (
        <ul className="hs-job-list">
          {shown.map((j) => (
            <li key={j.id} className="hs-card hs-job">
              <div>
                <h3><Link href={`/site/careers/jobs/${j.id}`}>{j.title}</Link></h3>
                <ul className="hs-meta">
                  <li><Icon name="briefcase" size={15} /> {j.department}</li>
                  <li><Icon name="pin" size={15} /> {j.location}</li>
                  <li><Icon name="clock" size={15} /> {j.type}</li>
                </ul>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                {j.workplace && <span className="hs-chip">{j.workplace}</span>}
                <span className="hs-link" aria-hidden="true">View &amp; apply <Icon name="arrow" size={16} /></span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
