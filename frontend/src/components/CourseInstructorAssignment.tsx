import { GraduationCap, Loader2 } from "lucide-react";
import { FormEvent, useState } from "react";
import { api } from "../api/client";
import type { User } from "../api/types";
import { Alert } from "./ui";
import { useT } from "../i18n";

/** A narrow write leaves the course, milestones, teams and enrollments untouched. */
export default function CourseInstructorAssignment({ projectId, currentId, instructors, onSaved }: { projectId: string; currentId: string | null; instructors: User[]; onSaved: () => void }) {
  const t = useT();
  const [selected, setSelected] = useState(currentId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(null);
    try { await api(`/api/projects/${projectId}/instructor`, { method: "PUT", body: { instructor_id: selected } }); onSaved(); }
    catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  };
  return <section className="course-instructor-control" aria-label={t("Course supervision")}>
    {!currentId && <div className="mb-4 flex items-start gap-3 text-sm text-slate-600"><GraduationCap size={20} className="shrink-0 text-brand-600" aria-hidden="true" /><p>{t("This course needs an instructor for academic reports. Assign one without changing its teams or assessments.")}</p></div>}
    <form onSubmit={submit}><div className="min-w-0 flex-1"><label className="label" htmlFor="course-instructor">{t("Course instructor")}</label>
      <select id="course-instructor" className="input" name="instructor_id" value={selected} required disabled={busy} onChange={e => setSelected(e.target.value)}><option value="">{t("Choose an instructor")}</option>{instructors.filter(i => i.is_active).map(i => <option key={i.id} value={i.id}>{i.full_name}</option>)}</select></div>
      <button className="btn-primary" disabled={busy || !selected || selected === currentId}>{busy && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}{currentId ? t("Update instructor") : t("Assign instructor")}</button>
    </form>
    {instructors.length === 0 && <p className="mt-3 text-xs text-slate-500">{t("Create an active instructor account in Users first.")}</p>}
    {error && <div role="alert" className="mt-3"><Alert kind="error">{error}</Alert></div>}
  </section>;
}
