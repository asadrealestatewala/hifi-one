"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { audit, requirePermission, toFileActor } from "@/lib/auth";
import { db } from "@/lib/db";
import { REQUEST_TYPE_LABEL, RequestError, cancelRequest, submitRequest, type RequestType } from "@/lib/employee-requests";
import { FileError, saveFile } from "@/lib/files";
import { notifyPermission } from "@/lib/notifications";
import { defaultStorage } from "@/lib/storage";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const back = (k: "error" | "msg", m: string): never => redirect(`/me/requests?${k}=${encodeURIComponent(m)}`);

// The employee sends an application to HR, with an optional file. HR (hr.manage) is notified; managers are not involved.
export async function submitRequestAction(formData: FormData): Promise<void> {
  const user = await requirePermission("self.leave");
  const file = formData.get("file");
  const hasFile = file instanceof File && file.size > 0;
  let id = "";
  try {
    const r = await submitRequest(db, { organizationId: user.organizationId, userId: user.id, type: str(formData, "type"), subject: str(formData, "subject"), body: str(formData, "body") });
    id = r.id;
    if (hasFile) {
      try {
        await saveFile(db, defaultStorage(), { actor: toFileActor(user), ownerType: "EMPLOYEE_REQUEST", ownerId: r.id, name: (file as File).name, bytes: Buffer.from(await (file as File).arrayBuffer()) });
      } catch (e) {
        // The application must not go to HR without the file the employee meant to attach
        await db.employeeRequest.delete({ where: { id: r.id } });
        if (e instanceof FileError) back("error", `${e.message} The application was not sent.`);
        throw e;
      }
    }
    await audit(user, { action: "request.submit", entity: "EmployeeRequest", entityId: r.id, after: { type: r.type, subject: r.subject, attachment: hasFile } });
    await notifyPermission(db, user.organizationId, "hr.manage", {
      kind: "request.submitted", title: `${user.name}: ${REQUEST_TYPE_LABEL[r.type as RequestType].toLowerCase()}`, body: r.subject, link: `/hr/requests?focus=${r.id}`, dedupeKey: `request:${r.id}`,
    }, user.id);
  } catch (e) {
    if (e instanceof RequestError) back("error", e.message);
    throw e;
  }
  revalidatePath("/me/requests");
  revalidatePath("/hr/requests");
  back("msg", id ? "Application sent. HR has been told and you will see their answer here." : "Application sent.");
}

export async function cancelRequestAction(formData: FormData): Promise<void> {
  const user = await requirePermission("self.leave");
  try {
    const r = await cancelRequest(db, { requestId: str(formData, "id"), userId: user.id });
    await audit(user, { action: "request.cancel", entity: "EmployeeRequest", entityId: r.id });
  } catch (e) {
    if (e instanceof RequestError) back("error", e.message);
    throw e;
  }
  revalidatePath("/me/requests");
  revalidatePath("/hr/requests");
  back("msg", "Application withdrawn.");
}
