import { Loader2, Presentation } from "lucide-react";
import { useState } from "react";
import { api } from "../../api/client";
import { Alert, askConfirm, useFetch } from "../../components/ui";
import { useT } from "../../i18n";
import { CopyCode } from "../student/TeamSetup";

interface Showcase {
  project: string;
  course_number: string;
  password: string;
  accounts: { role: string; name: string; email: string }[];
  teammates: string[];
}

/** Adds a sample course, staff and students so every feature can be demonstrated on the live system. */
export default function ShowcaseCard() {
  const t = useT();
  const status = useFetch(() => api<{ exists: boolean; domain: string }>("/api/admin/showcase"));
  const [created, setCreated] = useState<Showcase | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const create = async () => {
    if (!(await askConfirm(t("Add showcase data? A sample course with an instructor, an advisor and eight students (@{domain}) is created. Real courses are not changed.", { domain: status.data?.domain ?? "" })))) return;
    setBusy(true);
    setError(null);
    try {
      setCreated(await api<Showcase>("/api/admin/showcase", { body: {} }));
      status.reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <h2 className="flex items-center gap-2 font-semibold text-slate-900"><Presentation className="h-5 w-5 text-brand-600" /> {t("Showcase data")}</h2>
          <p className="mt-1 text-sm text-slate-500">{t("Adds a sample graduation-project course with two teams, completed 360° milestones, AI reports, a flagged comment and project files, so every feature can be shown. Its accounts share one password, shown once.")}</p>
        </div>
        {!created && (
          status.data?.exists
            ? <span className="badge bg-brand-50 text-brand-700">{t("Showcase data is already added. Change its passwords from Users.")}</span>
            : <button className="btn-primary" onClick={create} disabled={busy || !status.data}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} {t("Add showcase data")}</button>
        )}
      </div>
      {error && <div className="mt-4"><Alert kind="error" onClose={() => setError(null)}>{error}</Alert></div>}
      {created && (
        <div className="mt-5 space-y-4 rounded-xl border border-brand-100 bg-brand-50/50 p-5">
          <Alert kind="info">{t("Copy the password now. It is not shown again.")}</Alert>
          <div className="flex flex-wrap items-center gap-3 text-sm text-slate-600">
            {t("Password")} <CopyCode code={created.password} />
            <span className="ms-4">{t("Course number")}</span> <CopyCode code={created.course_number} />
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            {created.accounts.map((a) => (
              <div key={a.email} className="rounded-lg border border-slate-200 bg-white p-4">
                <div className="text-xs font-semibold uppercase tracking-wide text-brand-700">{t(a.role)}</div>
                <div className="mt-1 font-medium text-slate-900">{a.name}</div>
                <div className="mt-2"><CopyCode code={a.email} /></div>
              </div>
            ))}
          </div>
          <p className="text-xs text-slate-500">{t("Other student accounts (same password): {emails}", { emails: created.teammates.join(", ") })}</p>
        </div>
      )}
    </div>
  );
}
