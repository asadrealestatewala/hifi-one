import Link from "next/link";
import { Badge, SortTh } from "@/components/ui";
import { PLATFORM_LABEL, type Platform } from "@/lib/clout-rules";
import type { PostRow } from "@/lib/clout-views";

export const n = (v: number | null | undefined) => (v == null ? "–" : v.toLocaleString("en-US"));
export const signed = (v: number) => (v > 0 ? `+${v.toLocaleString("en-US")}` : v.toLocaleString("en-US"));
export function ago(d: Date | null, now = new Date()) {
  if (!d) return "never";
  const s = Math.max(0, Math.round((now.getTime() - d.getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}
export function every(sec: number) {
  if (sec < 120) return `${sec} s`;
  if (sec < 7200) return `${Math.round(sec / 60)} min`;
  if (sec < 172800) return `${Math.round(sec / 3600)} h`;
  return `${Math.round(sec / 86400)} days`;
}

const STATUS: Record<string, { label: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
  LIVE: { label: "Live", tone: "success" }, FAILED: { label: "Failed, retrying", tone: "warning" }, UNAVAILABLE: { label: "Deleted / unavailable", tone: "danger" }, PAUSED: { label: "Paused", tone: "neutral" },
};
export function CloutStatus({ status }: { status: string }) { const s = STATUS[status] ?? { label: status, tone: "neutral" as const }; return <Badge tone={s.tone}>{s.label}</Badge>; }
export const platformLabel = (p: string) => PLATFORM_LABEL[p as Platform] ?? p;

export type TableProps = { rows: PostRow[]; detailBase: string; sort: { key: string; dir: "asc" | "desc" }; hrefFor: (over: Record<string, string | undefined>) => string; showCampaign?: boolean; showInfluencer?: boolean };

// The posts table shared by the dashboard, a campaign and the client portal. Sorting lives in the address.
export function PostTable({ rows, detailBase, sort, hrefFor, showCampaign = true, showInfluencer = true }: TableProps) {
  return (
    <table className="w-full text-sm">
      <thead className="bg-hover/60 text-left text-xs text-muted"><tr>
        <SortTh label="Platform" field="platform" sort={sort} hrefFor={hrefFor} className="py-2 pl-4 pr-4" />
        <th className="pr-4">Post</th>
        {showInfluencer && <th className="pr-4">Influencer</th>}
        {showCampaign && <th className="pr-4">Campaign</th>}
        <SortTh label="Views" field="views" sort={sort} hrefFor={hrefFor} />
        <SortTh label="Likes" field="likes" sort={sort} hrefFor={hrefFor} />
        <SortTh label="Comments" field="comments" sort={sort} hrefFor={hrefFor} />
        <SortTh label="Views since last check" field="growth" sort={sort} hrefFor={hrefFor} />
        <SortTh label="Status" field="status" sort={sort} hrefFor={hrefFor} />
        <SortTh label="Last updated" field="checked" sort={sort} hrefFor={hrefFor} />
      </tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className="border-t border-border align-top transition hover:bg-hover/50">
            <td className="py-2 pl-4 pr-4 whitespace-nowrap">{platformLabel(r.platform)}</td>
            <td className="pr-4 max-w-xs">
              <Link href={`${detailBase}/${r.id}`} className="font-medium text-primary hover:underline">{r.authorHandle ? `@${r.authorHandle.replace(/^@/, "")}` : "Open post"}</Link>
              <p className="line-clamp-2 text-xs text-muted">{r.caption ?? r.url}</p>
              {r.quotaFallback && <p className="mt-0.5 text-xs text-warning">Fast lane full: updates every {every(r.effectiveSeconds)}</p>}
            </td>
            {showInfluencer && <td className="pr-4">{r.influencerName ?? <span className="text-muted">None</span>}</td>}
            {showCampaign && <td className="pr-4">{r.campaignName}</td>}
            <td className="pr-4 tabular-nums">{n(r.views)}</td>
            <td className="pr-4 tabular-nums">{n(r.likes)}</td>
            <td className="pr-4 tabular-nums">{n(r.comments)}</td>
            <td className={`pr-4 tabular-nums ${r.viewsDelta > 0 ? "text-success" : "text-muted"}`}>{r.lastSuccessAt ? signed(r.viewsDelta) : "–"}</td>
            <td className="pr-4"><CloutStatus status={r.status} />{r.status === "FAILED" && r.lastError && <p className="mt-0.5 max-w-[14rem] text-xs text-muted">{r.lastError}</p>}</td>
            <td className="pr-4 whitespace-nowrap text-muted">{ago(r.lastSuccessAt)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
