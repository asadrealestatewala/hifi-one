import { redirect } from "next/navigation";
import { audit, requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { BRANCH_KINDS, OrgError, addBranch, addDepartment, assignPerson, deleteDepartment, renameDepartment, updateBranch } from "@/lib/org-structure";

export const dynamic = "force-dynamic";

const back = (kind: "error" | "msg", m: string) => redirect(`/settings/organization?${kind}=${encodeURIComponent(m)}`);

async function act(formData: FormData) {
  "use server";
  const user = await requirePermission("users.manage");
  const org = user.organizationId;
  const op = String(formData.get("op") ?? "");
  const s = (k: string) => String(formData.get(k) ?? "");
  try {
    if (op === "addBranch") { const b = await addBranch(db, { organizationId: org, name: s("name"), kind: s("kind"), country: s("country"), address: s("address"), timezone: s("timezone") }); await audit(user, { action: "org.branch_add", entity: "Branch", entityId: b.id, after: { name: b.name } }); }
    else if (op === "saveBranch") { await updateBranch(db, { organizationId: org, branchId: s("id"), name: s("name"), kind: s("kind"), country: s("country"), address: s("address"), timezone: s("timezone"), active: formData.get("active") === "on" }); await audit(user, { action: "org.branch_update", entity: "Branch", entityId: s("id"), after: { name: s("name"), active: formData.get("active") === "on" } }); }
    else if (op === "addDept") { const d = await addDepartment(db, { organizationId: org, name: s("name") }); await audit(user, { action: "org.department_add", entity: "Department", entityId: d.id, after: { name: d.name } }); }
    else if (op === "renameDept") { await renameDepartment(db, { organizationId: org, departmentId: s("id"), name: s("name") }); await audit(user, { action: "org.department_rename", entity: "Department", entityId: s("id"), after: { name: s("name") } }); }
    else if (op === "deleteDept") { await deleteDepartment(db, { organizationId: org, departmentId: s("id") }); await audit(user, { action: "org.department_delete", entity: "Department", entityId: s("id") }); }
    else if (op === "assign") { await assignPerson(db, { organizationId: org, userId: s("userId"), branchId: s("branchId") || null, departmentId: s("departmentId") || null }); await audit(user, { action: "org.assign", entity: "User", entityId: s("userId"), after: { branchId: s("branchId") || null, departmentId: s("departmentId") || null } }); }
  } catch (e) {
    if (e instanceof OrgError) return back("error", e.message);
    throw e;
  }
  back("msg", "Saved.");
}

export default async function Organization({ searchParams }: { searchParams: Promise<{ error?: string; msg?: string }> }) {
  const user = await requirePermission("users.view");
  const sp = await searchParams;
  const org = user.organizationId;
  const canEdit = user.permissions.has("users.manage");
  const [branches, departments, people] = await Promise.all([
    db.branch.findMany({ where: { organizationId: org }, orderBy: [{ active: "desc" }, { name: "asc" }], include: { _count: { select: { users: true } } } }),
    db.department.findMany({ where: { organizationId: org }, orderBy: { name: "asc" }, include: { _count: { select: { users: true } } } }),
    db.user.findMany({ where: { organizationId: org, userType: "EMPLOYEE", active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, branchId: true, departmentId: true } }),
  ]);
  const hid = (op: string, id?: string) => (<><input type="hidden" name="op" value={op} />{id && <input type="hidden" name="id" value={id} />}</>);
  return (
    <div className="space-y-6 max-w-4xl">
      <h1 className="text-2xl font-semibold tracking-tight">Offices and departments</h1>
      {sp.msg && <p className="text-sm bg-green-600/10 text-green-700 rounded-lg px-3 py-2">{sp.msg}</p>}
      {sp.error && <p role="alert" className="text-sm text-brand bg-brand/10 rounded-lg px-3 py-2">{sp.error}</p>}

      <section className="card space-y-3">
        <h2 className="font-semibold">Branches and offices</h2>
        {branches.map((b) => (
          <form key={b.id} action={act} className="grid gap-2 sm:grid-cols-[1fr_9rem_8rem_9rem_auto] items-end border-t border-border pt-3 first:border-0 first:pt-0">
            {hid("saveBranch", b.id)}
            <div><label className="label" htmlFor={`bn-${b.id}`}>Name ({b._count.users} people)</label><input id={`bn-${b.id}`} name="name" defaultValue={b.name} disabled={!canEdit} className="input" /></div>
            <div><label className="label" htmlFor={`bk-${b.id}`}>Type</label><select id={`bk-${b.id}`} name="kind" defaultValue={b.kind} disabled={!canEdit} className="input">{BRANCH_KINDS.map((k) => <option key={k} value={k}>{k.toLowerCase().replace("_", " ")}</option>)}</select></div>
            <div><label className="label" htmlFor={`bc-${b.id}`}>Country</label><input id={`bc-${b.id}`} name="country" defaultValue={b.country ?? ""} disabled={!canEdit} className="input" /></div>
            <div><label className="label" htmlFor={`bt-${b.id}`}>Time zone</label><input id={`bt-${b.id}`} name="timezone" defaultValue={b.timezone ?? ""} placeholder="Asia/Karachi" disabled={!canEdit} className="input" /></div>
            {canEdit ? <button className="btn-ghost">Save</button> : <span />}
            <div className="sm:col-span-4"><label className="label" htmlFor={`ba-${b.id}`}>Address</label><input id={`ba-${b.id}`} name="address" defaultValue={b.address ?? ""} disabled={!canEdit} className="input" /></div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={b.active} disabled={!canEdit} /> Active</label>
          </form>
        ))}
        {canEdit && (
          <form action={act} className="grid gap-2 sm:grid-cols-[1fr_9rem_8rem_9rem_auto] items-end border-t border-border pt-3">
            {hid("addBranch")}
            <div><label className="label" htmlFor="nb-name">New branch</label><input id="nb-name" name="name" required maxLength={100} className="input" /></div>
            <div><label className="label" htmlFor="nb-kind">Type</label><select id="nb-kind" name="kind" className="input" defaultValue="OFFICE">{BRANCH_KINDS.map((k) => <option key={k} value={k}>{k.toLowerCase().replace("_", " ")}</option>)}</select></div>
            <div><label className="label" htmlFor="nb-country">Country</label><input id="nb-country" name="country" className="input" /></div>
            <div><label className="label" htmlFor="nb-tz">Time zone</label><input id="nb-tz" name="timezone" placeholder="Asia/Karachi" className="input" /></div>
            <button className="btn">Add</button>
            <div className="sm:col-span-5"><label className="label" htmlFor="nb-addr">Address</label><input id="nb-addr" name="address" className="input" /></div>
          </form>
        )}
      </section>

      <section className="card space-y-2">
        <h2 className="font-semibold">Departments</h2>
        {departments.length === 0 && <p className="text-sm text-muted">No departments yet.</p>}
        {departments.map((d) => (
          <div key={d.id} className="flex flex-wrap items-center gap-2 border-t border-border pt-2 first:border-0 first:pt-0">
            <form action={act} className="flex items-center gap-2">{hid("renameDept", d.id)}<input name="name" defaultValue={d.name} aria-label={`Rename ${d.name}`} disabled={!canEdit} className="input !w-56" />{canEdit && <button className="btn-ghost">Rename</button>}</form>
            <span className="text-xs text-muted">{d._count.users} {d._count.users === 1 ? "person" : "people"}</span>
            {canEdit && d._count.users === 0 && <form action={act}>{hid("deleteDept", d.id)}<button className="underline text-xs">Delete</button></form>}
          </div>
        ))}
        {canEdit && <form action={act} className="flex gap-2 border-t border-border pt-3">{hid("addDept")}<input name="name" required maxLength={100} placeholder="New department" aria-label="New department" className="input !w-64" /><button className="btn">Add</button></form>}
      </section>

      {canEdit && (
        <section className="card space-y-2">
          <h2 className="font-semibold">Assign a person</h2>
          <form action={act} className="flex flex-wrap items-end gap-3">
            {hid("assign")}
            <div><label className="label" htmlFor="as-user">Person</label><select id="as-user" name="userId" required className="input"><option value="">Choose…</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
            <div><label className="label" htmlFor="as-branch">Branch</label><select id="as-branch" name="branchId" className="input"><option value="">None</option>{branches.filter((b) => b.active).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></div>
            <div><label className="label" htmlFor="as-dept">Department</label><select id="as-dept" name="departmentId" className="input"><option value="">None</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></div>
            <button className="btn-ghost">Assign</button>
          </form>
          <p className="text-xs text-muted">Choosing &quot;None&quot; for both removes the person from every branch and department.</p>
        </section>
      )}
    </div>
  );
}
