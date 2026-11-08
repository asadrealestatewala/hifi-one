import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { CIRCULAR_KINDS, acknowledgeCircular, myCirculars } from "@/lib/circulars";
import { revalidatePath } from "next/cache";
import { Badge, Empty, PageHeader, SubmitButton } from "@/components/ui";

export const dynamic = "force-dynamic";

async function confirm(formData: FormData): Promise<void> {
  "use server";
  const user = await requireUser();
  await acknowledgeCircular(db, user.id, String(formData.get("id")));
  revalidatePath("/me/circulars");
}

export default async function MyCirculars() {
  const user = await requireUser();
  const items = await myCirculars(db, user.id);
  return (
    <div className="space-y-4 max-w-3xl">
      <PageHeader title="Circulars" subtitle="Notices from HR and management addressed to you." />
      {items.length === 0 ? <div className="card"><Empty title="No circulars">When HR sends you one it shows up here.</Empty></div> : items.map((c) => (
        <article key={c.id} className="card space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">{c.title}</h2>
            <div className="flex items-center gap-2"><Badge tone={c.kind === "URGENT" ? "danger" : "neutral"}>{CIRCULAR_KINDS[c.kind as keyof typeof CIRCULAR_KINDS] ?? c.kind}</Badge>{c.acknowledged && <Badge tone="success">read</Badge>}</div>
          </div>
          <p className="text-xs text-muted">From {c.from} · {c.at.slice(0, 16).replace("T", " ")}</p>
          <p className="whitespace-pre-wrap text-sm">{c.body}</p>
          {!c.acknowledged && <form action={confirm}><input type="hidden" name="id" value={c.id} /><SubmitButton pendingText="Saving…">I have read this</SubmitButton></form>}
        </article>
      ))}
    </div>
  );
}
