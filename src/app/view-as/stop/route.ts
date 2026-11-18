import { audit, requireSession } from "@/lib/auth";
import { VIEW_AS_USER_COOKIE } from "@/lib/view-as";
import { cookies } from "next/headers";

const back = (to: string) => new Response(null, { status: 303, headers: { Location: to } });

// Ends "View as a person". Only the Super Admin who started it can have an active view, and the end is written to the audit log.
export async function POST() {
  const user = await requireSession();
  (await cookies()).delete(VIEW_AS_USER_COOKIE);
  const v = user?.viewAsPerson;
  if (!user || !v) return back("/dashboard");
  await audit(user, { action: "auth.view_as_person_stop", entity: "User", entityId: v.userId });
  return back("/users");
}
