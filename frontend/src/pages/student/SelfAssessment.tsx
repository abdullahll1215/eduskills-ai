import { CheckCircle2, Pencil, X } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { api } from "../../api/client";
import type { Competency, Milestone } from "../../api/types";
import { Alert, Loading, PageHeader, fmtDate, useFetch } from "../../components/ui";
import { useT } from "../../i18n";
import { RatingSlider, useStudentMilestone } from "./shared";

interface SelfData {
  milestone: Milestone | null;
  competencies: Competency[];
  submission: { ratings: Record<string, number>; evidence: string; evidence_link: string | null; created_at: string; is_locked: boolean } | null;
}

export default function SelfAssessment() {
  const t = useT();
  const { milestone, loading: l1, error: e1, reload: reloadProjects } = useStudentMilestone();
  const [personalMode, setPersonalMode] = useState(false);
  const personal = personalMode || !milestone;
  if (l1) return <Loading />;
  if (e1) return <Alert kind="error">{e1}</Alert>;
  return <div>
    <PageHeader title={t("Self-Assessment")} subtitle={t("Rate your own soft skills on a 1–5 Likert scale.")} />
    {milestone && <div className="mb-4">
      <label className="label" htmlFor="assessment-context">{t("Assessment context")}</label>
      <select id="assessment-context" className="input max-w-md" value={personal ? "personal" : "course"} onChange={(e) => setPersonalMode(e.target.value === "personal")}>
        <option value="course">{t("Course assessment")} · {milestone.name}</option>
        <option value="personal">{t("Personal self-assessment")}</option>
      </select>
    </div>}
    <AssessmentForm key={personal ? "personal" : milestone!.id} personal={personal} milestone={milestone} reloadProjects={reloadProjects} />
  </div>;
}

function AssessmentForm({ personal, milestone, reloadProjects }: { personal: boolean; milestone: Milestone | null; reloadProjects: () => void }) {
  const t = useT();
  const endpoint = personal ? "/api/student/personal-self-assessment" : "/api/student/self-assessment";
  const { data, loading, error, reload } = useFetch(
    () => api<SelfData>(endpoint, personal ? undefined : { params: { milestone_id: milestone!.id } }),
    [milestone?.id, personal],
  );
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  // A saved assessment is read-only until the student taps Edit, so ratings are not changed by accident.
  const [editing, setEditing] = useState(false);

  const load = () => {
    if (!data) return;
    const init: Record<string, number> = {};
    data.competencies.forEach((c) => (init[c.id] = data.submission?.ratings[c.id] ?? 3));
    setRatings(init);
    setTouched(new Set(data.submission ? data.competencies.map((c) => c.id) : []));
    setEditing(!data.submission);
  };
  useEffect(load, [data]);

  if (loading && !data) return <Loading />;
  if (error) return <Alert kind="error">{error}</Alert>;
  if (!data) return <Alert>{t("No evaluation period is available yet.")}</Alert>;

  const saved = !!data.submission;
  const closed = !personal && milestone?.status !== "active";
  const missing = data.competencies.filter((c) => !touched.has(c.id));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (missing.length) {
      setMsg({ kind: "error", text: t("Please rate every skill (missing: {skills}).", { skills: missing.map((m) => t(m.skill_name)).join(t(", ")) }) });
      return;
    }
    setBusy(true);
    try {
      await api(endpoint, { body: { ...(personal ? {} : { milestone_id: milestone!.id }), ratings } });
      setMsg({ kind: "success", text: t("Self-assessment saved.") });
      setEditing(false);
      reload();
      reloadProjects();
    } catch (err) {
      setMsg({ kind: "error", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="space-y-4">
        {personal && <Alert title={t("Personal self-assessment")}>{t("Assess your own skills privately, without a course or team. Personal ratings are separate from your course assessment.")}</Alert>}
        {msg && <Alert kind={msg.kind} onClose={() => setMsg(null)}>{msg.text}</Alert>}
        {saved && (
          <Alert kind="info">
            <span className="inline-flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5" /> {t("Last saved on {date}.", { date: fmtDate(data.submission!.created_at, true) })} {!closed && t("Tap Edit to change your ratings.")}</span>
          </Alert>
        )}
        {closed && <Alert kind="warning" title={t("Evaluation Period Closed")}>{t("The self-assessment is not accepting submissions right now. It opens again when your instructor starts the next evaluation period.")}</Alert>}

        <form onSubmit={submit} className="card assessment-sheet p-5 sm:p-7">
          <h2 className="font-semibold text-slate-900">{t("5-Skill Rubric")}</h2>
          <p className="text-sm text-slate-500">{t("Move each slider; the descriptor below explains what each level means.")}</p>
          <div className="mt-2 divide-y divide-slate-100">
            {data.competencies.map((c) => (
              <RatingSlider
                key={c.id}
                label={t(c.skill_name)}
                description={!touched.has(c.id) && !saved ? t("Not rated yet") : undefined}
                value={ratings[c.id] ?? 3}
                rubric={c.rubric}
                disabled={closed || !editing}
                onChange={(v) => {
                  setRatings({ ...ratings, [c.id]: v });
                  setTouched(new Set(touched).add(c.id));
                }}
              />
            ))}
          </div>
          {!closed && (
            <div className="assessment-actions mt-6 flex justify-end gap-2">
              {saved &&
                (editing ? (
                  <button type="button" className="btn-outline" onClick={load}><X className="h-4 w-4" /> {t("Cancel")}</button>
                ) : (
                  <button type="button" className="btn-outline" onClick={() => { setEditing(true); setMsg(null); }}><Pencil className="h-4 w-4" /> {t("Edit")}</button>
                ))}
              <button className="btn-primary" disabled={busy || !editing}>{t("Save")}</button>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
