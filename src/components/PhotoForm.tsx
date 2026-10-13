"use client";

import { useRef, useState } from "react";
import { removePhotoAction, uploadPhotoAction } from "@/app/(app)/me/profile/actions";

// Pick a picture, see it straight away, then save. The server checks type, size and contents again.
export default function PhotoForm({ userId, returnTo, hasPhoto }: { userId: string; returnTo: string; hasPhoto: boolean }) {
  const form = useRef<HTMLFormElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState("");
  return (
    <div className="space-y-2">
      <form ref={form} action={uploadPhotoAction} className="space-y-2">
        <input type="hidden" name="userId" value={userId} />
        <input type="hidden" name="returnTo" value={returnTo} />
        <label className="btn-ghost inline-flex cursor-pointer">
          {hasPhoto ? "Change picture" : "Add a picture"}
          <input name="photo" type="file" accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => {
            const f = e.target.files?.[0];
            setError("");
            if (!f) { setPreview(null); return; }
            if (f.size > 2 * 1024 * 1024) { setError("The picture must be 2 MB or smaller."); e.target.value = ""; setPreview(null); return; }
            setPreview(URL.createObjectURL(f));
          }} />
        </label>
        {preview && (
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview} alt="Preview of the new picture" className="h-14 w-14 rounded-full object-cover" />
            <button className="btn">Save picture</button>
            <button type="button" className="btn-ghost" onClick={() => { setPreview(null); form.current?.reset(); }}>Cancel</button>
          </div>
        )}
        {error && <p role="alert" className="text-xs text-brand">{error}</p>}
        <p className="text-xs text-muted">PNG, JPG or WebP, up to 2 MB. Colleagues see it next to the name across the system.</p>
      </form>
      {hasPhoto && !preview && (
        <form action={removePhotoAction}>
          <input type="hidden" name="userId" value={userId} />
          <input type="hidden" name="returnTo" value={returnTo} />
          <button className="text-xs text-muted hover:text-brand hover:underline">Remove picture</button>
        </form>
      )}
    </div>
  );
}
