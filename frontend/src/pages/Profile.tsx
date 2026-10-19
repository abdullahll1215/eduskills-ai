import { FormEvent, useState } from "react";
import { api } from "../api/client";
import { Alert, PageHeader } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { useT } from "../i18n";

export default function Profile() {
  const { user, refresh } = useAuth();
  const t = useT();
  const [form, setForm] = useState({ full_name: user?.full_name ?? "", mobile: user?.mobile ?? "", level: user?.level ?? "", department: user?.department ?? "" });
  const [pw, setPw] = useState({ current_password: "", new_password: "" });
  const [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  if (!user) return null;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api("/api/auth/me", { method: "PUT", body: form });
      await refresh();
      setMsg({ kind: "success", text: t("Profile updated.") });
    } catch (err) {
      setMsg({ kind: "error", text: (err as Error).message });
    }
  };

  const changePw = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api("/api/auth/change-password", { body: pw });
      setPw({ current_password: "", new_password: "" });
      setMsg({ kind: "success", text: t("Password changed.") });
    } catch (err) {
      setMsg({ kind: "error", text: (err as Error).message });
    }
  };

  return (
    <div>
      <PageHeader title={t("My Profile")} subtitle={`${user.email} · ${t(user.role)}${user.student_number ? " · " + user.student_number : ""}`} />
      {msg && (
        <div className="mb-4">
          <Alert kind={msg.kind} onClose={() => setMsg(null)}>{msg.text}</Alert>
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        <form onSubmit={save} className="card space-y-4 p-6">
          <h2 className="font-semibold text-slate-900">{t("Personal information")}</h2>
          <div>
            <label className="label">{t("Full name")}</label>
            <input className="input" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label">{t("Mobile")}</label>
              <input className="input" value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} />
            </div>
            <div>
              <label className="label">{t("Level")}</label>
              <input className="input" value={form.level} onChange={(e) => setForm({ ...form, level: e.target.value })} />
            </div>
          </div>
          <div>
            <label className="label">{t("Department")}</label>
            <input className="input" value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} />
          </div>
          <button className="btn-primary">{t("Save changes")}</button>
        </form>
        <form onSubmit={changePw} className="card space-y-4 p-6">
          <h2 className="font-semibold text-slate-900">{t("Change password")}</h2>
          <div>
            <label className="label">{t("Current password")}</label>
            <input type="password" className="input" value={pw.current_password} onChange={(e) => setPw({ ...pw, current_password: e.target.value })} required />
          </div>
          <div>
            <label className="label">{t("New password (min. 8 characters)")}</label>
            <input type="password" className="input" minLength={8} value={pw.new_password} onChange={(e) => setPw({ ...pw, new_password: e.target.value })} required />
          </div>
          <button className="btn-primary">{t("Update password")}</button>
        </form>
      </div>
    </div>
  );
}
