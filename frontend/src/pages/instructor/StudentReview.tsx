import { ArrowLeft, GitCommitHorizontal, Lock, RefreshCw, ShieldAlert } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api } from "../../api/client";
import type { Competency, Milestone, Report } from "../../api/types";
import { Alert, LevelBadge, Loading, Modal, PageHeader, fmt, fmtDate, useFetch } from "../../components/ui";
import { useT } from "../../i18n";
import { RatingSlider } from "../student/shared";
import { MilestoneSelect } from "./shared";

interface Detail {
  student: { id: string; full_name: string; email: string; student_number: string; level: string };
  team: string | null;
  milestone: Milestone;
  milestones: Milestone[];
  competencies: Competency[];
  status: { self_done: boolean; peer_count: number; min_peers: number; instructor_done: boolean };
  skills: { competency_id: string; code: string; name: string; peer_avg: number | null; self: number | null; instructor: number | null; external: number | null; gap: number | null; level: string | null }[];
  self_evidence: string | null;
  peer_comments: { id: string; text: string; moderation: string; flag_reason: string | null; sentiment: number | null }[];
  artifacts: { id: string; kind: string; title: string; url: string | null; metrics: Record<string, unknown>; created_at: string }[];
  artifact_summary: { total_commits: number; indicators: { label: string; value: string; signal: string }[] };
  instructor_evaluation: { ratings: Record<string, number>; notes: string; created_at: string; is_locked: boolean } | null;
  report: Report | null;
  history: { milestone: string; self: number; external: number; gap: number; level: string }[];
  warning_threshold: number;
}

const MODERATION: Record<string, string> = { pending: "Pending review", approved: "Approved", removed: "Removed" };

export default function StudentReview() {
  const t = useT();
  const { studentId } = useParams();
  const [params, setParams] = useSearchParams();
  const projectId = params.get("project") ?? "";
  const milestoneId = params.get("milestone") ?? undefined;
  const { data, loading, error, reload } = useFetch(
    () => api<Detail>(`/api/instructor/students/${studentId}`, { params: { project_id: projectId, milestone_id: milestoneId } }),
    [studentId, projectId, milestoneId],
  );
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [notes, setNotes] = useState("");
  const [warnings, setWarnings] = useState<string[] | null>(null);
  const [msg, setMsg] = useState<{ kind: "success" | "error" | "info"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [intervention, setIntervention] = useState<string | null>(null);

  useEffect(() => {
    if (!data) return;
    const init: Record<string, number> = {};
    data.competencies.forEach((c) => (init[c.id] = data.instructor_evaluation?.ratings[c.id] ?? 3));
    setRatings(init);
    setNotes(data.instructor_evaluation?.notes ?? "");
  }, [data]);

  if (loading && !data) return <Loading />;
  if (error) return <Alert kind="error">{error}</Alert>;
  if (!data) return null;

  const done = !!data.instructor_evaluation;
  const ready = data.status.self_done && data.status.peer_count >= data.status.min_peers;
  const liveExternal = (cid: string) => {
    const s = data.skills.find((x) => x.competency_id === cid);
    return s?.peer_avg != null ? 0.6 * ratings[cid] + 0.4 * s.peer_avg : null;
  };

  const submit = async (e: FormEvent | null, acknowledge = false) => {
    e?.preventDefault();
    setBusy(true);
    try {
      const res = await api<{ saved: boolean; requires_confirmation?: boolean; warnings: string[]; external?: number }>("/api/instructor/evaluations", {
        body: { milestone_id: data.milestone.id, target_id: data.student.id, ratings, notes, acknowledge_warnings: acknowledge },
      });
      if (res.requires_confirmation) {
        setWarnings(res.warnings);
      } else {
        setWarnings(null);
        setMsg({ kind: "success", text: t("Evaluation locked. Final external score {score}. Blind-spot detection and the AI report are running...", { score: fmt(res.external, 2) }) });
        setTimeout(reload, 1500);
      }
    } catch (err) {
      setMsg({ kind: "error", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const regenerate = async () => {
    setBusy(true);
    try {
      await api(`/api/instructor/reports/${data.student.id}/${data.milestone.id}/regenerate`, { method: "POST" });
      setMsg({ kind: "success", text: t("AI report regenerated.") });
      reload();
    } catch (err) {
      setMsg({ kind: "error", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const raise = async () => {
    try {
      await api("/api/instructor/interventions", { body: { student_id: data.student.id, milestone_id: data.milestone.id, reason: intervention } });
      setIntervention(null);
      setMsg({ kind: "success", text: t("Intervention alert sent to the Student Advisor.") });
    } catch (err) {
      setMsg({ kind: "error", text: (err as Error).message });
    }
  };

  return (
    <div className="space-y-6">
      <Link to={`/instructor?project=${projectId}&milestone=${data.milestone.id}`} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="h-4 w-4 rtl:rotate-180" /> {t("Back to console")}
      </Link>
      <PageHeader
        title={data.student.full_name}
        subtitle={`${data.student.student_number ?? ""} · ${data.team ?? t("No team")} · ${data.student.email}`}
        actions={
          <>
            <MilestoneSelect milestones={data.milestones} value={data.milestone.id} onChange={(id) => setParams({ project: projectId, milestone: id })} />
            <button className="btn-outline" onClick={() => setIntervention(t("Follow-up needed for {name} (M{n}).", { name: data.student.full_name, n: data.milestone.number }))}>
              <ShieldAlert className="h-4 w-4" /> {t("Raise intervention")}
            </button>
          </>
        }
      />
      {msg && <Alert kind={msg.kind} onClose={() => setMsg(null)}>{msg.text}</Alert>}

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <form onSubmit={(e) => submit(e)} className="card p-6">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-slate-900">{t("Instructor Evaluation · M{n} (60% weight)", { n: data.milestone.number })}</h2>
            {done && <span className="badge bg-slate-100 text-slate-600"><Lock className="me-1 h-3 w-3" /> {t("Locked {date}", { date: fmtDate(data.instructor_evaluation!.created_at) })}</span>}
          </div>
          {!ready && (
            <div className="mt-4">
              <Alert kind="warning" title={t("Preconditions not met")}>
                {data.status.self_done ? t("Self-assessment: done") : t("Self-assessment: missing")} · {t("Peer evaluations: {count}/{min} required.", { count: data.status.peer_count, min: data.status.min_peers })}
              </Alert>
            </div>
          )}
          <div className="mt-3 divide-y divide-slate-50">
            {data.competencies.map((c) => {
              const s = data.skills.find((x) => x.competency_id === c.id);
              const ext = liveExternal(c.id);
              const diff = s?.peer_avg != null ? Math.abs(ratings[c.id] - s.peer_avg) : 0;
              return (
                <div key={c.id}>
                  <RatingSlider label={t(c.skill_name)} value={ratings[c.id] ?? 3} rubric={c.rubric} disabled={done || !ready} onChange={(v) => setRatings({ ...ratings, [c.id]: v })} />
                  <div className="-mt-1 mb-2 flex flex-wrap gap-x-4 text-xs text-slate-500 sm:ms-[192px]">
                    <span>{t("Peer avg:")} <b>{fmt(s?.peer_avg)}</b></span>
                    {ext != null && <span>{t("Projected external:")} <b className="text-brand-600">{fmt(ext, 2)}</b></span>}
                    {s?.self != null && <span>{t("Self:")} <b>{s.self}</b></span>}
                    {s?.level && <LevelBadge level={s.level} />}
                    {!done && diff > data.warning_threshold && <span className="font-medium text-amber-600">⚠ {t("differs from peers by {n}", { n: diff.toFixed(1) })}</span>}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-4">
            <label className="label">{t("Supervisory notes")}</label>
            <textarea className="input min-h-[100px]" value={notes} disabled={done || !ready} onChange={(e) => setNotes(e.target.value)} placeholder={t("Observations from meetings, commits, deliverables...")} />
          </div>
          {!done && ready && (
            <div className="mt-5 flex justify-end">
              <button className="btn-primary" disabled={busy}>{t("Submit & Lock Evaluation")}</button>
            </div>
          )}
          {!done && <p className="mt-3 text-xs text-slate-400">{t("The student's self-ratings are hidden until you submit, to avoid anchoring bias.")}</p>}
        </form>

        <div className="space-y-4">
          <div className="card p-5">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900"><GitCommitHorizontal className="h-4 w-4 text-brand-600" /> {t("Behavioral artifacts")}</h3>
            {data.artifacts.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">{t("No artifacts uploaded for this milestone.")}</p>
            ) : (
              <>
                <div className="mt-3 space-y-2">
                  {data.artifact_summary.indicators.map((i) => (
                    <div key={i.label} className={`rounded-lg px-3 py-2 text-sm ${i.signal === "positive" ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"}`}>
                      <div className="text-xs opacity-70">{i.label}</div>
                      <div className="font-semibold">{i.value}</div>
                    </div>
                  ))}
                  <div className="text-xs text-slate-500">{t("{n} commits total", { n: data.artifact_summary.total_commits })}</div>
                </div>
                <ul className="mt-3 space-y-1 text-xs text-slate-500">
                  {data.artifacts.map((a) => (
                    <li key={a.id}>• {a.title} ({a.kind.replace("_", " ")})</li>
                  ))}
                </ul>
              </>
            )}
          </div>
          <div className="card p-5">
            <h3 className="text-sm font-semibold text-slate-900">{t("Anonymous peer comments ({n})", { n: data.peer_comments.length })}</h3>
            <div className="mt-3 max-h-80 space-y-2 overflow-y-auto">
              {data.peer_comments.map((c) => (
                <div key={c.id} className={`rounded-lg border p-3 text-xs ${c.moderation === "pending" ? "border-red-200 bg-red-50" : "border-slate-100 bg-slate-50"}`}>
                  <div className="italic text-slate-700">"{c.text}"</div>
                  {c.moderation !== "none" && <div className="mt-1 font-medium text-slate-500">{t("Moderation: {status}", { status: t(MODERATION[c.moderation] ?? c.moderation) })}{c.flag_reason ? ` · ${c.flag_reason}` : ""}</div>}
                </div>
              ))}
            </div>
          </div>
          {data.history.length > 0 && (
            <div className="card p-5">
              <h3 className="text-sm font-semibold text-slate-900">{t("Longitudinal history")}</h3>
              <table className="mt-2 w-full text-xs">
                <thead><tr className="text-start text-slate-400"><th className="py-1">{t("MS")}</th><th>{t("Self")}</th><th>{t("Ext.")}</th><th>Δ</th><th></th></tr></thead>
                <tbody>
                  {data.history.map((h) => (
                    <tr key={h.milestone} className="border-t border-slate-100">
                      <td className="py-1.5 font-medium">{h.milestone}</td><td>{fmt(h.self)}</td><td>{fmt(h.external)}</td><td>{fmt(h.gap)}</td><td><LevelBadge level={h.level} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {data.report && (
        <div className="card p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold text-slate-900">{t("AI Developmental Report · M{n}", { n: data.report.milestone.number })}</h2>
            <div className="flex items-center gap-2">
              <LevelBadge level={data.report.overall_level} />
              <span className="text-xs text-slate-400">{data.report.source === "ai" ? t("Generative AI") : t("Template engine")} · {fmtDate(data.report.generated_at, true)}</span>
              <button className="btn-outline px-3 py-1.5 text-xs" onClick={regenerate} disabled={busy}><RefreshCw className="h-3.5 w-3.5" /> {t("Regenerate")}</button>
            </div>
          </div>
          <p className="mt-3 font-medium text-slate-800">{data.report.content.headline}</p>
          <div className="mt-2 space-y-2 text-sm text-slate-700">{data.report.content.paragraphs.map((p, i) => <p key={i}>{p}</p>)}</div>
          {data.self_evidence && <div className="mt-4 rounded-lg bg-slate-50 p-3 text-xs text-slate-600"><b>{t("Student reflection:")}</b> {data.self_evidence}</div>}
        </div>
      )}

      <Modal
        open={!!warnings}
        title={t("Significant perception difference")}
        onClose={() => setWarnings(null)}
        footer={
          <>
            <button className="btn-ghost" onClick={() => setWarnings(null)}>{t("Review scores")}</button>
            <button className="btn-primary" onClick={() => submit(null, true)} disabled={busy}>{t("Submit anyway")}</button>
          </>
        }
      >
        <p className="text-sm text-slate-600">{t("Your ratings differ from the peer average by more than {n} points:", { n: data.warning_threshold })}</p>
        <ul className="mt-3 list-inside list-disc space-y-1 text-sm text-amber-700">{warnings?.map((w) => <li key={w}>{w}</li>)}</ul>
        <p className="mt-3 text-xs text-slate-500">{t("Consider adding supervisory notes that explain the difference.")}</p>
      </Modal>

      <Modal
        open={intervention !== null}
        title={t("Raise intervention for Student Advisor")}
        onClose={() => setIntervention(null)}
        footer={
          <>
            <button className="btn-ghost" onClick={() => setIntervention(null)}>{t("Cancel")}</button>
            <button className="btn-primary" onClick={raise} disabled={(intervention ?? "").length < 5}>{t("Send alert")}</button>
          </>
        }
      >
        <label className="label">{t("Reason")}</label>
        <textarea className="input min-h-[100px]" value={intervention ?? ""} onChange={(e) => setIntervention(e.target.value)} />
      </Modal>
    </div>
  );
}
