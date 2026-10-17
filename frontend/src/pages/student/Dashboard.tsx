import { AlertTriangle, CheckCircle2, Download, Sparkles, TrendingUp } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api, download } from "../../api/client";
import type { MilestoneStatus, Report } from "../../api/types";
import { Alert, Empty, Loading, PageHeader, StatCard, fmt, useFetch } from "../../components/ui";

interface DashboardData {
  project: { id: string; title: string } | null;
  latest: Report | null;
  trend: { milestone: string; name: string; self: number; external: number; gap: number }[];
  milestones: MilestoneStatus[];
  provisional: { milestone: MilestoneStatus; skills: { skill: string; self: number | null; peer_avg: number | null }[] } | null;
}

export default function Dashboard() {
  const { data, loading, error } = useFetch(() => api<DashboardData>("/api/student/dashboard"));
  const [exportError, setExportError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  if (loading) return <Loading />;
  if (error) return <Alert kind="error">{error}</Alert>;
  if (!data?.project) return <Empty title="You are not enrolled in a project yet">Ask your instructor to add you to a project team.</Empty>;

  const latest = data.latest;
  const blindSpots = latest?.metrics.filter((m) => m.level !== "ALIGNED").sort((a, b) => b.gap - a.gap) ?? [];
  const worst = blindSpots[0];
  const radar = latest?.metrics.map((m) => ({ skill: m.skill, Self: m.self, External: m.external })) ?? [];

  const exportPassport = async () => {
    setExportError(null);
    setExporting(true);
    try {
      await download("/api/student/passport.pdf", "skills-passport.pdf", { project_id: data.project!.id });
    } catch (e) {
      setExportError((e as Error).message);
    } finally {
      setExporting(false);
    }
  };

  const active = data.milestones.find((m) => m.status === "active");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Longitudinal Growth Trajectory"
        subtitle={latest ? `Review your latest 360-degree assessment results (M${latest.milestone.number} · ${latest.milestone.name}).` : data.project.title}
        actions={
          <>
            <button className="btn-outline" onClick={exportPassport} disabled={!latest || exporting}>
              <Download className="h-4 w-4" /> Export Skills Passport
            </button>
            <button className="btn-ghost" onClick={() => download("/api/student/passport.csv", "skills-passport.csv", { project_id: data.project!.id }).catch((e) => setExportError(e.message))} disabled={!latest}>
              CSV
            </button>
          </>
        }
      />
      {exportError && <Alert kind="error" onClose={() => setExportError(null)}>{exportError}</Alert>}

      {active && !active.self_done && (
        <Alert kind="info" title={`M${active.number} evaluation period is open`}>
          Submit your self-assessment for <b>{active.name}</b>.{" "}
          <Link to={`/student/self-assessment?milestone=${active.id}`} className="font-semibold underline">Start now</Link>
        </Alert>
      )}

      {!latest ? (
        <Empty title="No Data Available" icon={<Sparkles className="h-8 w-8 text-brand-500" />}>
          Your first growth report will appear once your self-assessment, at least 3 peer evaluations and your instructor's evaluation are complete.
        </Empty>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard label="Self-Awareness Score" value={fmt(latest.overall_self)} hint="Out of 5.0" />
            <StatCard label="External Score (Weighted)" value={fmt(latest.overall_external)} hint="60% Instructor, 40% Peer" />
            <StatCard
              label="Discrepancy (Delta Δ)"
              value={fmt(latest.overall_gap)}
              hint={worst ? `Largest skill gap: ${worst.skill} (Δ ${fmt(worst.gap)})` : "Well aligned"}
              tone={latest.overall_level === "CRITICAL_GAP" ? "danger" : latest.overall_level === "MODERATE_GAP" ? "warning" : "success"}
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <div className="card p-6 lg:col-span-2">
              <h2 className="font-semibold text-slate-900">Skills Radar Comparison</h2>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <RadarChart data={radar} outerRadius="65%">
                    <PolarGrid stroke="#e2e8f0" />
                    <PolarAngleAxis dataKey="skill" tick={{ fontSize: 11, fill: "#475569" }} />
                    <PolarRadiusAxis domain={[0, 5]} tickCount={6} tick={false} axisLine={false} />
                    <Radar name="Self Score" dataKey="Self" stroke="#4f46e5" fill="#6366f1" fillOpacity={0.25} strokeWidth={2} />
                    <Radar name="External Score" dataKey="External" stroke="#94a3b8" fill="#cbd5e1" fillOpacity={0.45} strokeWidth={2} />
                    <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                    <Tooltip />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="card p-6">
              <h2 className="font-semibold text-slate-900">Milestone Progress</h2>
              <div className="mt-4 space-y-4">
                {data.milestones.map((m) => (
                  <div key={m.id}>
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-700">Milestone {m.number} ({m.name})</span>
                      <span className="text-slate-500">{m.progress}%</span>
                    </div>
                    <div className="mt-1.5 h-2 rounded-full bg-slate-100">
                      <div className="h-2 rounded-full bg-brand-500" style={{ width: `${m.progress}%` }} />
                    </div>
                    <div className="mt-1 text-[11px] text-slate-400">
                      {m.self_done ? "Self ✓" : "Self —"} · Peers given {m.peers_given}/{m.peers_total} · Received {m.peers_received}/{m.min_peers}+ · {m.instructor_done ? "Instructor ✓" : "Instructor —"}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {worst ? (
            <div className={`rounded-xl border p-5 ${worst.level === "CRITICAL_GAP" ? "border-red-200 bg-red-50" : "border-amber-200 bg-amber-50"}`}>
              <div className="flex gap-3">
                <AlertTriangle className={`h-5 w-5 shrink-0 ${worst.level === "CRITICAL_GAP" ? "text-red-600" : "text-amber-600"}`} />
                <div>
                  <div className={`font-semibold ${worst.level === "CRITICAL_GAP" ? "text-red-700" : "text-amber-700"}`}>
                    {worst.level === "CRITICAL_GAP" ? "Critical Blind Spot Detected (Δ > 2.0)" : "Perception Gap Detected (Δ > 1.5)"}
                  </div>
                  <p className={`mt-1 text-sm ${worst.level === "CRITICAL_GAP" ? "text-red-600" : "text-amber-700"}`}>
                    {worst.direction === "overestimate" ? (
                      <>Your self-assessment in <b>{worst.skill}</b> ({worst.self}) significantly exceeds the external evaluation by your peers and instructor ({fmt(worst.external)}).</>
                    ) : (
                      <>Others rate your <b>{worst.skill}</b> ({fmt(worst.external)}) much higher than you rate yourself ({worst.self}) — a hidden strength.</>
                    )}{" "}
                    The AI Engine has generated a developmental report for you.
                  </p>
                  <Link to={`/student/report?milestone=${latest.milestone.id}`} className="btn-outline mt-3 bg-white">View AI Narrative Report</Link>
                </div>
              </div>
            </div>
          ) : (
            <Alert kind="success" title="Good alignment">Your self-perception matches how your peers and instructor see you across all five skills.</Alert>
          )}

          {data.trend.length > 0 && (
            <div className="card p-6">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-brand-600" />
                <h2 className="font-semibold text-slate-900">Blind Spot Trend Line</h2>
              </div>
              <p className="text-sm text-slate-500">How your self-perception, external score and perception gap evolve across milestones.</p>
              <div className="mt-4 h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data.trend} margin={{ left: -20, right: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="milestone" tick={{ fontSize: 12 }} />
                    <YAxis domain={[0, 5]} tick={{ fontSize: 12 }} />
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Line type="monotone" dataKey="self" name="Self" stroke="#4f46e5" strokeWidth={2} dot={{ r: 4 }} />
                    <Line type="monotone" dataKey="external" name="External (weighted)" stroke="#0ea5e9" strokeWidth={2} dot={{ r: 4 }} />
                    <Line type="monotone" dataKey="gap" name="Delta Δ" stroke="#ef4444" strokeWidth={2} strokeDasharray="5 4" dot={{ r: 4 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          <div className="card overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-100">
              <thead className="bg-slate-50">
                <tr>
                  <th className="th">Skill</th>
                  <th className="th">Self</th>
                  <th className="th">Peers</th>
                  <th className="th">Instructor</th>
                  <th className="th">External</th>
                  <th className="th">Δ</th>
                  <th className="th">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {latest.metrics.map((m) => (
                  <tr key={m.code}>
                    <td className="td font-medium">{m.skill}</td>
                    <td className="td">{m.self}</td>
                    <td className="td">{fmt(m.peer_avg)}</td>
                    <td className="td">{m.instructor}</td>
                    <td className="td font-semibold text-brand-600">{fmt(m.external, 2)}</td>
                    <td className="td">{fmt(m.gap, 2)}</td>
                    <td className="td">
                      {m.level === "ALIGNED" ? (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600"><CheckCircle2 className="h-4 w-4" /> Aligned</span>
                      ) : (
                        <span className={`badge ${m.level === "CRITICAL_GAP" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>
                          {m.direction === "overestimate" ? "Blind spot" : "Hidden strength"} · {m.level === "CRITICAL_GAP" ? "Critical" : "Moderate"}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
