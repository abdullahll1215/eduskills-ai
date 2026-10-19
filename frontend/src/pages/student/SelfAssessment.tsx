import { Lock } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { api } from "../../api/client";
import type { Competency, Milestone } from "../../api/types";
import { Alert, askConfirm, Loading, PageHeader, fmtDate, useFetch } from "../../components/ui";
import { RatingSlider, useStudentMilestone } from "./shared";

interface SelfData {
  milestone: Milestone;
  competencies: Competency[];
  submission: { ratings: Record<string, number>; evidence: string; evidence_link: string | null; created_at: string; is_locked: boolean } | null;
}

export default function SelfAssessment() {
  const { milestone, loading: l1, error: e1, reload: reloadProjects } = useStudentMilestone();
  const { data, loading, error, reload } = useFetch(
    () => (milestone ? api<SelfData>("/api/student/self-assessment", { params: { milestone_id: milestone.id } }) : Promise.resolve(null)),
    [milestone?.id],
  );
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [evidence, setEvidence] = useState("");
  const [link, setLink] = useState("");
  const [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!data) return;
    const init: Record<string, number> = {};
    data.competencies.forEach((c) => (init[c.id] = data.submission?.ratings[c.id] ?? 3));
    setRatings(init);
    setTouched(new Set(data.submission ? data.competencies.map((c) => c.id) : []));
    setEvidence(data.submission?.evidence ?? "");
    setLink(data.submission?.evidence_link ?? "");
    setMsg(null);
  }, [data]);

  if (l1 || (loading && !data)) return <Loading />;
  if (e1 || error) return <Alert kind="error">{e1 || error}</Alert>;
  if (!milestone || !data) return <Alert>No evaluation period is available yet.</Alert>;

  const locked = !!data.submission;
  const closed = milestone.status !== "active";
  const missing = data.competencies.filter((c) => !touched.has(c.id));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (missing.length) {
      setMsg({ kind: "error", text: `Please rate every skill (missing: ${missing.map((m) => m.skill_name).join(", ")}).` });
      return;
    }
    if (!(await askConfirm("Once submitted, your self-assessment is locked and cannot be changed. Submit now?"))) return;
    setBusy(true);
    try {
      await api("/api/student/self-assessment", { body: { milestone_id: milestone.id, ratings, evidence, evidence_link: link || null } });
      setMsg({ kind: "success", text: "Self-assessment submitted and locked. Your report will be generated once peer and instructor evaluations are complete." });
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
      <PageHeader title="Self-Assessment" subtitle="Rate your own soft skills on a 1–5 Likert scale and provide evidence." />

      <div className="space-y-4">
        {msg && <Alert kind={msg.kind} onClose={() => setMsg(null)}>{msg.text}</Alert>}
        {locked && (
          <Alert kind="info" title="Submitted — read-only">
            <span className="inline-flex items-center gap-1"><Lock className="h-3.5 w-3.5" /> Locked on {fmtDate(data.submission!.created_at, true)}.</span>
          </Alert>
        )}
        {!locked && closed && <Alert kind="warning" title="Evaluation Period Closed">The self-assessment is not accepting submissions right now. It opens again when your instructor starts the next evaluation period.</Alert>}

        <form onSubmit={submit} className="card p-6">
          <h2 className="font-semibold text-slate-900">5-Skill Rubric</h2>
          <p className="text-sm text-slate-500">Move each slider; the descriptor below explains what each level means.</p>
          <div className="mt-2 divide-y divide-slate-100">
            {data.competencies.map((c) => (
              <RatingSlider
                key={c.id}
                label={c.skill_name}
                description={!touched.has(c.id) && !locked ? "Not rated yet" : undefined}
                value={ratings[c.id] ?? 3}
                rubric={c.rubric}
                disabled={locked || closed}
                onChange={(v) => {
                  setRatings({ ...ratings, [c.id]: v });
                  setTouched(new Set(touched).add(c.id));
                }}
              />
            ))}
          </div>
          <div className="mt-4 grid gap-4">
            <div>
              <label className="label">Evidence & reflection</label>
              <textarea
                className="input min-h-[110px]"
                value={evidence}
                disabled={locked || closed}
                onChange={(e) => setEvidence(e.target.value)}
                placeholder="Describe concrete situations from your project work that support your ratings..."
              />
            </div>
            <div>
              <label className="label">Evidence link (optional)</label>
              <input className="input" value={link} disabled={locked || closed} onChange={(e) => setLink(e.target.value)} placeholder="https://github.com/... or a shared document" />
            </div>
          </div>
          {!locked && !closed && (
            <div className="mt-6 flex justify-end">
              <button className="btn-primary" disabled={busy}>Submit & Lock Self-Assessment</button>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
