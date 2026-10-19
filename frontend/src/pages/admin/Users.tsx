import { Pencil, Plus, UserX } from "lucide-react";
import { FormEvent, useState } from "react";
import { api } from "../../api/client";
import type { User } from "../../api/types";
import { Alert, askConfirm, Loading, Modal, PageHeader, fmtDate, useFetch } from "../../components/ui";
import { useT } from "../../i18n";

type Form = { id?: string; full_name: string; email: string; role: string; password: string; student_number: string; level: string; mobile: string; department: string; is_active: boolean };
const EMPTY: Form = { full_name: "", email: "", role: "student", password: "", student_number: "", level: "", mobile: "", department: "", is_active: true };

const ROLE_LABELS: Record<string, string> = { student: "Student", instructor: "Instructor", advisor: "Advisor", admin: "Admin" };

export default function Users() {
  const t = useT();
  const [q, setQ] = useState("");
  const [role, setRole] = useState("");
  const { data, loading, error, reload } = useFetch(() => api<User[]>("/api/admin/users", { params: { q, role } }), [q, role]);
  const [form, setForm] = useState<Form | null>(null);
  const [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!form) return;
    const body = { ...form, password: form.password || null, student_number: form.student_number || null };
    try {
      if (form.id) await api(`/api/admin/users/${form.id}`, { method: "PUT", body });
      else await api("/api/admin/users", { body });
      setForm(null);
      setMsg({ kind: "success", text: t("User saved.") });
      reload();
    } catch (err) {
      setMsg({ kind: "error", text: (err as Error).message });
    }
  };

  const deactivate = async (u: User) => {
    if (!(await askConfirm(t("Deactivate {name}?", { name: u.full_name })))) return;
    try {
      await api(`/api/admin/users/${u.id}`, { method: "DELETE" });
      reload();
    } catch (err) {
      setMsg({ kind: "error", text: (err as Error).message });
    }
  };

  return (
    <div>
      <PageHeader title={t("Users")} subtitle={t("Identity & Access Management with role-based access control.")} actions={<button className="btn-primary" onClick={() => setForm({ ...EMPTY })}><Plus className="h-4 w-4" /> {t("New user")}</button>} />
      {msg && <div className="mb-4"><Alert kind={msg.kind} onClose={() => setMsg(null)}>{msg.text}</Alert></div>}
      <div className="card mb-4 flex flex-wrap gap-3 p-4">
        <input className="input sm:w-72" placeholder={t("Search name, email or ID...")} value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input w-auto" value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="">{t("All roles")}</option>
          <option value="student">{t("Students")}</option>
          <option value="instructor">{t("Instructors")}</option>
          <option value="advisor">{t("Advisors")}</option>
          <option value="admin">{t("Admins")}</option>
        </select>
      </div>
      {loading && !data ? (
        <Loading />
      ) : error ? (
        <Alert kind="error">{error}</Alert>
      ) : (
        <div className="card overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-100">
            <thead className="bg-slate-50"><tr><th className="th">{t("Name")}</th><th className="th">{t("Email")}</th><th className="th">{t("Role")}</th><th className="th">{t("ID / Dept.")}</th><th className="th">{t("Last login")}</th><th className="th">{t("Status")}</th><th className="th"></th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {data?.map((u) => (
                <tr key={u.id} className={u.is_active ? "" : "opacity-50"}>
                  <td className="td font-medium">{u.full_name}</td>
                  <td className="td">{u.email}</td>
                  <td className="td capitalize">{ROLE_LABELS[u.role] ? t(ROLE_LABELS[u.role]) : u.role}</td>
                  <td className="td text-xs text-slate-500">{u.student_number ?? u.department ?? "—"}</td>
                  <td className="td text-xs text-slate-500">{fmtDate(u.last_login_at, true)}</td>
                  <td className="td"><span className={`badge ${u.is_active ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{u.is_active ? t("Active") : t("Disabled")}</span></td>
                  <td className="td whitespace-nowrap text-end">
                    <button className="btn-ghost p-1.5" aria-label={t("Edit user")} title={t("Edit user")} onClick={() => setForm({ ...EMPTY, ...Object.fromEntries(Object.entries(u).map(([k, v]) => [k, v ?? ""])), password: "", is_active: u.is_active } as Form)}><Pencil className="h-4 w-4" /></button>
                    {u.is_active && <button className="btn-ghost p-1.5 text-red-500" aria-label={t("Deactivate user")} title={t("Deactivate user")} onClick={() => deactivate(u)}><UserX className="h-4 w-4" /></button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={!!form} title={form?.id ? t("Edit user") : t("New user")} onClose={() => setForm(null)}>
        {form && (
          <form onSubmit={save} className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2"><label className="label">{t("Full name")}</label><input className="input" required value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></div>
            <div className="sm:col-span-2"><label className="label">{t("Institutional email")}</label><input type="email" className="input" dir="ltr" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
            <div>
              <label className="label">{t("Role")}</label>
              <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                {Object.entries(ROLE_LABELS).map(([v, l]) => <option key={v} value={v}>{t(l)}</option>)}
              </select>
            </div>
            <div><label className="label">{form.id ? t("New password (optional)") : t("Password")}</label><input type="password" className="input" minLength={8} required={!form.id} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></div>
            <div><label className="label">{t("Student ID")}</label><input className="input" value={form.student_number} onChange={(e) => setForm({ ...form, student_number: e.target.value })} /></div>
            <div><label className="label">{t("Level")}</label><input className="input" value={form.level} onChange={(e) => setForm({ ...form, level: e.target.value })} /></div>
            <div><label className="label">{t("Mobile")}</label><input className="input" value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} /></div>
            <div><label className="label">{t("Department")}</label><input className="input" value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} /></div>
            <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} /> {t("Active")}</label>
            <div className="flex justify-end sm:col-span-2"><button className="btn-primary">{t("Save")}</button></div>
          </form>
        )}
      </Modal>
    </div>
  );
}
