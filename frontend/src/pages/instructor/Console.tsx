import { AlertTriangle, Download, FileText, ShieldCheck, Users } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api, download } from "../../api/client";
import type { Milestone } from "../../api/types";
import { Alert, Empty, Loading, PageHeader, StatCard, StatusBadge, fmt, fmtDate, useFetch } from "../../components/ui";
import { useT } from "../../i18n";
import { MilestoneSelect, ProjectPicker, useInstructorSelection } from "./shared";

interface Row {
  student_id: string;
  full_name: string;
  student_number: string;
  team: string | null;
  self_done: boolean;
  peer_count: number;
  instructor_done: boolean;
  peer_avg: number | null;
  instructor_avg: number | null;
  external: number | null;
  gap: number | null;
  max_skill_gap: number | null;
  level: string | null;
  status: string;
  ready_for_instructor: boolean;
}

interface Overview {
  project: { id: string; title: string };
  milestone: Milestone;
  milestones: Milestone[];
  stats: { total_students: number; pending_reviews: number; at_risk_groups: number; flagged_comments: number; completed: number; open_interventions: number };
  at_risk_teams: string[];
  rows: Row[];
  flagged: { id: string; target: string; target_id: string; milestone: string; comment: string; reason: string; created_at: string }[];
  interventions: { id: string; student: string; reason: string; status: string; created_at: string }[];
}

export default function InstructorConsole() {
  const t = useT();
  const sel = useInstructorSelection();
  const { data, loading, error, reload } = useFetch(
    () => (sel.project ? api<Overview>("/api/instructor/overview", { params: { project_id: sel.project.id, milestone_id: sel.milestoneId } }) : Promise.resolve(null)),
    [sel.project?.id, sel.milestoneId],
  );
  const [search, setSearch] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  if (sel.loading || (loading && !data)) return <Loading />;
  if (sel.error || error) return <Alert kind="error">{sel.error || error}</Alert>;
  if (!sel.project) return <Empty title={t("No projects yet")}>{t("Create a project under “Projects & Teams” to start evaluating students.")}</Empty>;
  if (!data) return <Loading />;

  const rows = data.rows.filter((r) => `${r.full_name} ${r.student_number} ${r.team}`.toLowerCase().includes(search.toLowerCase()));

  const moderate = async (id: string, action: "approve" | "remove") => {
    await api(`/api/instructor/moderation/${id}`, { body: { action } });
    setMsg(action === "approve" ? t("Comment approved and left visible (false flag).") : t("Comment removed anonymously. The action was logged."));
    reload();
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("Instructor Analytics Console")}
        subtitle={t("{project} — monitor cohort performance and moderate flagged peer feedback.", { project: data.project.title })}
        actions={
          <>
            <ProjectPicker projects={sel.projects ?? []} value={sel.project.id} onChange={(id) => sel.set({ project: id })} />
            <MilestoneSelect milestones={data.milestones} value={data.milestone.id} onChange={(id) => sel.set({ milestone: id })} />
            <button className="btn-outline" onClick={() => download("/api/instructor/export.csv", `cohort-M${data.milestone.number}.csv`, { project_id: data.project.id, milestone_id: data.milestone.id })}>
              <Download className="h-4 w-4" /> {t("Export")}
            </button>
          </>
        }
      />
      {msg && <Alert kind="success" onClose={() => setMsg(null)}>{msg}</Alert>}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={t("Total Students")} value={data.stats.total_students} icon={<Users className="h-5 w-5 text-brand-500" />} />
        <StatCard label={t("Pending Reviews")} value={data.stats.pending_reviews} hint={t("Ready for your evaluation")} icon={<FileText className="h-5 w-5 text-amber-500" />} />
        <StatCard label={t("At-Risk Groups")} value={data.stats.at_risk_groups} hint={data.at_risk_teams.join(t(", ")) || t("None")} icon={<AlertTriangle className="h-5 w-5 text-red-500" />} />
        <StatCard label={t("Flagged Comments")} value={data.stats.flagged_comments} icon={<ShieldCheck className="h-5 w-5 text-emerald-500" />} />
      </div>

      {data.stats.at_risk_groups === 0 && data.stats.completed > 0 && <Alert kind="success">{t("No high-priority risks detected — normal cohort status.")}</Alert>}

      <div className="card overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="font-semibold text-slate-900">{t("Cohort Evaluation Status · M{n}", { n: data.milestone.number })}</h2>
          <input className="input sm:w-56" placeholder={t("Search student...")} value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-100">
            <thead className="bg-slate-50">
              <tr>
                <th className="th">{t("Student Name")}</th>
                <th className="th">{t("Team")}</th>
                <th className="th">{t("360° Progress")}</th>
                <th className="th">{t("Peer Avg")}</th>
                <th className="th">{t("Inst Score")}</th>
                <th className="th">{t("Final Ext.")}</th>
                <th className="th">{t("Detected Gap")}</th>
                <th className="th">{t("Status")}</th>
                <th className="th"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.student_id} className="hover:bg-slate-50">
                  <td className="td font-medium text-slate-900">{r.full_name}</td>
                  <td className="td whitespace-nowrap text-slate-500">{r.team ?? "—"}</td>
                  <td className="td whitespace-nowrap text-xs text-slate-500">
                    {r.self_done ? t("Self ✓") : t("Self —")} · {t("Peers {n}", { n: r.peer_count })} · {r.instructor_done ? t("Inst ✓") : t("Inst —")}
                  </td>
                  <td className="td">{fmt(r.peer_avg)}</td>
                  <td className="td">{fmt(r.instructor_avg)}</td>
                  <td className="td font-semibold text-brand-600">{fmt(r.external)}</td>
                  <td className="td">{r.max_skill_gap != null ? fmt(r.max_skill_gap) : "—"}</td>
                  <td className="td whitespace-nowrap"><StatusBadge status={r.status} /></td>
                  <td className="td text-end">
                    <Link
                      to={`/instructor/students/${r.student_id}?project=${data.project.id}&milestone=${data.milestone.id}`}
                      className={r.ready_for_instructor ? "btn-primary px-3 py-1.5 text-xs" : "btn-outline px-3 py-1.5 text-xs"}
                    >
                      {r.ready_for_instructor ? t("Evaluate") : t("View")}
                    </Link>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={9} className="td py-10 text-center text-slate-400">{t("No students found.")}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card p-5">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-semibold text-slate-900"><ShieldCheck className="h-5 w-5 text-brand-600" /> {t("Flagged Peer Feedback (Review Queue)")}</h2>
          <span className={`badge ${data.flagged.length ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"}`}>{t("{n} Pending", { n: data.flagged.length })}</span>
        </div>
        <div className="mt-4 space-y-3">
          {data.flagged.length === 0 && <div className="text-sm text-slate-500">{t("No flagged comments.")} 🎉</div>}
          {data.flagged.map((f) => (
            <div key={f.id} className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="text-xs text-slate-500">{t("Target: {target} | Reviewer: Anonymous | {milestone} · {date}", { target: f.target, milestone: f.milestone, date: fmtDate(f.created_at) })}</div>
                <div className="mt-1 text-sm font-medium italic text-slate-800">"{f.comment}"</div>
                <div className="mt-1 text-xs text-red-600">{t("Flag Reason: {reason}", { reason: f.reason })}</div>
              </div>
              <div className="flex shrink-0 gap-2">
                <button className="btn-outline" onClick={() => moderate(f.id, "approve")}>{t("Approve")}</button>
                <button className="btn-danger" onClick={() => moderate(f.id, "remove")}>{t("Delete Comment")}</button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {data.interventions.length > 0 && (
        <div className="card p-5">
          <h2 className="font-semibold text-slate-900">{t("Open Advisor Interventions")}</h2>
          <div className="mt-3 divide-y divide-slate-100">
            {data.interventions.map((i) => (
              <div key={i.id} className="flex items-start justify-between gap-3 py-3">
                <div>
                  <div className="text-sm font-medium text-slate-800">{i.student}</div>
                  <div className="text-xs text-slate-500">{i.reason}</div>
                </div>
                <StatusBadge status={i.status} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
