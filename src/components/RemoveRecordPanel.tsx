import ConfirmButton from "@/components/ui/ConfirmButton";
import { describeBlockers, type Blocker } from "@/lib/record-removal";

// "Archive or delete" card at the bottom of a project or client page, for people with records.delete.
// Delete only appears when nothing real is attached (blockers empty); otherwise it says what is in the way.
export default function RemoveRecordPanel({ kind, name, idField, id, archived, canArchive, archiveHint, blockers, archiveAction, restoreAction, deleteAction, archiveLabel, restoreLabel }: {
  kind: "project" | "client"; name: string; idField: string; id: string; archived: boolean; canArchive: boolean; archiveHint?: string; blockers: Blocker[];
  archiveAction: (fd: FormData) => Promise<void>; restoreAction: (fd: FormData) => Promise<void>; deleteAction: (fd: FormData) => Promise<void>;
  archiveLabel: string; restoreLabel: string;
}) {
  return (
    <section className="card space-y-3 border-danger/30">
      <div>
        <h2 className="font-semibold">Archive or delete this {kind}</h2>
        <p className="text-sm text-muted">For {kind}s made by mistake or while testing. Archiving keeps everything and can be undone. Deleting is permanent and is recorded in the audit log.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {archived ? (
          <form action={restoreAction}><input type="hidden" name={idField} value={id} /><input type="hidden" name="active" value="1" />
            <button className="btn-ghost">{restoreLabel}</button></form>
        ) : canArchive ? (
          <form action={archiveAction}><input type="hidden" name={idField} value={id} /><input type="hidden" name="active" value="0" />
            <ConfirmButton title={`${archiveLabel}?`} message={`${name} will be hidden from the ${kind} lists. Nothing is deleted and you can restore it at any time.`} confirmLabel={archiveLabel}>{archiveLabel}</ConfirmButton></form>
        ) : archiveHint ? <p className="text-sm text-muted">{archiveHint}</p> : null}
        {blockers.length === 0 && (
          <form action={deleteAction}><input type="hidden" name={idField} value={id} />
            <ConfirmButton className="btn-ghost !text-danger" title={`Delete ${name} for good?`} confirmText={name} confirmLabel={`Delete ${kind}`}
              message={kind === "project"
                ? "The project, its tasks, comments, milestones, updates and members are removed permanently. This cannot be undone."
                : "The client and its content settings (brand kit, hashtag sets, connected accounts, unused invites) are removed permanently. This cannot be undone."}>
              Delete {kind}
            </ConfirmButton></form>
        )}
      </div>
      {blockers.length > 0 && <p className="text-sm text-muted">Can&apos;t be deleted because it has {describeBlockers(blockers)}. {kind === "project" ? "Archive it instead." : "Mark it inactive instead."}</p>}
    </section>
  );
}
