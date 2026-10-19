import { Activity, BookOpen, CheckCircle2, ExternalLink, Sparkles } from "lucide-react";
import { api } from "../../api/client";
import type { Report } from "../../api/types";
import { Alert, Empty, LevelBadge, Loading, PageHeader, fmt, fmtDate, useFetch } from "../../components/ui";
import VideoSuggestion from "../../components/VideoSuggestion";
import { useStudentMilestone } from "./shared";

export default function GrowthReport() {
  const { milestone, loading: l1, error: e1 } = useStudentMilestone("latest-report");
  const { data: report, loading, error } = useFetch(
    () => (milestone?.report_id ? api<Report>(`/api/student/reports/${milestone.id}`) : Promise.resolve(null)),
    [milestone?.id, milestone?.report_id],
  );

  if (l1 || loading) return <Loading />;
  if (e1 || error) return <Alert kind="error">{e1 || error}</Alert>;
  if (!milestone) return <Alert>No evaluation period is available yet.</Alert>;

  const focus = report?.metrics.slice().sort((a, b) => b.gap - a.gap)[0];
  const c = report?.content;

  return (
    <div>
      <PageHeader
        title="AI Developmental Narrative"
        subtitle={report ? `Generated ${report.source === "ai" ? "by AI" : "by the analytics engine"} based on your latest evaluations · ${fmtDate(report.generated_at)}` : "Your personalized growth report"}
      />

      {!report || !c ? (
        <Empty title="Report not available yet" icon={<Sparkles className="h-8 w-8 text-brand-500" />}>
          Your AI report is generated automatically once your self-assessment, at least {milestone.min_peers} peer evaluations
          ({milestone.peers_received} received) and the instructor evaluation ({milestone.instructor_done ? "done" : "pending"}) are complete.
        </Empty>
      ) : (
        <div className="space-y-6">
          {focus && focus.level !== "ALIGNED" ? (
            <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-5">
              <div className="h-fit rounded-full bg-amber-100 p-2"><Activity className="h-5 w-5 text-amber-600" /></div>
              <div>
                <div className="font-semibold text-amber-900">Johari Window Insight: {focus.direction === "overestimate" ? '"Blind Spot"' : '"Hidden Strength"'} Context</div>
                <p className="mt-1 text-sm text-amber-800">
                  The following report focuses on a significant variance (Delta: {fmt(focus.gap)}) discovered in your <b>{focus.skill}</b> skill.{" "}
                  {focus.direction === "overestimate"
                    ? "This indicates a behavior visible to your peers and instructor, but potentially unknown to you."
                    : "Others see a strength here that you may be underestimating."}
                </p>
              </div>
            </div>
          ) : (
            <Alert kind="success" title="Open area: well aligned">{c.johari_insight || "Your self-perception is aligned with external feedback."}</Alert>
          )}

          <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
            <div className="card p-7">
              <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-4">
                <h2 className="text-lg font-semibold text-slate-900">Behavioral Narrative Analysis</h2>
                <span className={`badge ${report.source === "ai" ? "bg-brand-100 text-brand-700" : "bg-slate-100 text-slate-600"}`}>{report.source === "ai" ? "Generative AI" : "Template engine"}</span>
              </div>
              {c.headline && <p className="mt-4 font-medium text-slate-800">{c.headline}</p>}
              <div className="mt-3 space-y-4 leading-relaxed text-slate-700">
                {c.paragraphs.map((p, i) => <p key={i}>{p}</p>)}
              </div>
              {c.strengths.length > 0 && (
                <div className="mt-6">
                  <div className="text-sm font-semibold text-slate-800">Recognized strengths</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {c.strengths.map((s) => <span key={s} className="badge bg-emerald-50 text-emerald-700">{s}</span>)}
                  </div>
                </div>
              )}
              <VideoSuggestion metrics={report.metrics} resources={c.resources ?? []} aiQuery={c.video_query} />
            </div>

            <div className="space-y-6">
              <div className="card p-6">
                <h3 className="font-semibold text-slate-900">Actionable Steps</h3>
                <ul className="mt-4 space-y-3">
                  {c.actionable_steps.map((s) => (
                    <li key={s} className="flex gap-2.5 text-sm text-slate-700">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" /> {s}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="rounded-xl bg-slate-800 p-6 text-white shadow-sm">
                <h3 className="flex items-center gap-2 font-semibold"><BookOpen className="h-4 w-4" /> Recommended Resources</h3>
                <div className="mt-4 space-y-3">
                  {c.resources.length === 0 && <div className="text-sm text-slate-300">No resources needed — keep it up!</div>}
                  {c.resources.map((r) => (
                    <a key={r.url + r.title} href={r.url} target="_blank" rel="noreferrer" className="block rounded-lg border border-slate-600 p-3 transition hover:border-slate-400 hover:bg-slate-700">
                      <div className="flex items-start justify-between gap-2 text-sm font-semibold">
                        {r.title} ({r.provider}) <ExternalLink className="h-3.5 w-3.5 shrink-0 opacity-60" />
                      </div>
                      <div className="mt-0.5 text-xs text-slate-400">{r.duration} · {r.skill}</div>
                    </a>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="card overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-100">
              <thead className="bg-slate-50">
                <tr>
                  <th className="th">Skill</th><th className="th">Self</th><th className="th">External</th><th className="th">Δ</th><th className="th">Level</th><th className="th">Peer themes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {report.metrics.map((m) => {
                  const t = c.themes?.[m.code];
                  return (
                    <tr key={m.code}>
                      <td className="td font-medium">{m.skill}</td>
                      <td className="td">{m.self}</td>
                      <td className="td">{fmt(m.external, 2)}</td>
                      <td className="td">{fmt(m.gap, 2)}</td>
                      <td className="td"><LevelBadge level={m.level} /></td>
                      <td className="td text-xs text-slate-500">{t ? `${t.mentions} mentions · ${t.positive}+ / ${t.negative}−` : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
