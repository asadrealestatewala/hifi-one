import { signDownload } from "@/lib/files";

const kb = (n: number) => (n >= 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

// Signed links to the files on one employee application. The caller has already decided the viewer may see the application.
export default function RequestAttachments({ files, viewerId }: { files: { id: string; filename: string; size: number; scanStatus: string }[]; viewerId: string }) {
  if (files.length === 0) return null;
  const secret = process.env.SESSION_SECRET ?? "";
  return (
    <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs">
      {files.map((f) => (
        <li key={f.id}>
          <a className="underline" href={`/api/files/${f.id}?t=${signDownload(f.id, viewerId, secret)}`} target="_blank" rel="noopener">{f.filename}</a>
          <span className="text-muted"> · {kb(f.size)}{f.scanStatus === "CLEAN" ? "" : " · not virus-scanned"}</span>
        </li>
      ))}
    </ul>
  );
}
