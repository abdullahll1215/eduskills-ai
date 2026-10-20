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
import { useT } from "../../i18n";
import { fill } from "./shared";
import { TeamStrip } from "./TeamSetup";
import Explore from "./Explore";

interface DashboardData {
  project: { id: string; title: string } | null;
  latest: Report | null;
  trend: { milestone: string; name: string; self: number; external: number; gap: number }[];
  milestones: MilestoneStatus[];
  provisional: { milestone: MilestoneStatus; skills: { skill: string; self: number | null; peer_avg: number | null }[] } | null;
}

export default function Dashboard() {
  const t = useT();
  const { data, loading, error } = useFetch(() => api<DashboardData>("/api/student/dashboard"));
  const [exportError, setExportError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  if (loading) return <Loading />;
  if (error) return <Alert kind="error">{error}</Alert>;
  if (!data?.project) return <Explore />;

  const latest = data.latest;
  const blindSpots = latest?.metrics.filter((m) => m.level !== "ALIGNED").sort((a, b) => b.gap - a.gap) ?? [];
  const worst = blindSpots[0];
  const radar = latest?.metrics.map((m) => ({ skill: t(m.skill), Self: m.self, External: m.external })) ?? [];

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
        title={t("Longitudinal Growth Trajectory")}
        subtitle={latest ? t("Review your latest 360-degree assessment results (M{n} · {name}).", { n: latest.milestone.number, name: latest.milestone.name }) : data.project.title}
        actions={
          <>
            <button className="btn-outline" onClick={exportPassport} disabled={!latest || exporting}>
              <Download className="h-4 w-4" /> {t("Export Skills Passport")}
            </button>
            <button className="btn-ghost" onClick={() => download("/api/student/passport.csv", "skills-passport.csv", { project_id: data.project!.id }).catch((e) => setExportError(e.message))} disabled={!latest}>
              CSV
            </button>
          </>
        }
      />
      {exportError && <Alert kind="error" onClose={() => setExportError(null)}>{exportError}</Alert>}
      <TeamStrip />

      {active && !active.self_done && (
        <Alert kind="info" title={t("M{n} evaluation period is open", { n: active.number })}>
          {fill(t("Submit your self-assessment for {name}."), { name: <b>{active.name}</b> })}{" "}
          <Link to={`/student/self-assessment?milestone=${active.id}`} className="font-semibold underline">{t("Start now")}</Link>
        </Alert>
      )}

      {!latest ? (
        <Empty title={t("No Data Available")} icon={<Sparkles className="h-8 w-8 text-brand-500" />}>
          {t("Your first growth report will appear once your self-assessment, at least 3 peer evaluations and your instructor's evaluation are complete.")}
        </Empty>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard label={t("Self-Awareness Score")} value={fmt(latest.overall_self)} hint={t("Out of 5.0")} />
            <StatCard label={t("External Score (Weighted)")} value={fmt(latest.overall_external)} hint={t("60% Instructor, 40% Peer")} />
            <StatCard
              label={t("Discrepancy (Delta Δ)")}
              value={fmt(latest.overall_gap)}
              hint={worst ? t("Largest skill gap: {skill} (Δ {gap})", { skill: t(worst.skill), gap: fmt(worst.gap) }) : t("Well aligned")}
              tone={latest.overall_level === "CRITICAL_GAP" ? "danger" : latest.overall_level === "MODERATE_GAP" ? "warning" : "success"}
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <div className="card p-6 lg:col-span-2">
              <h2 className="font-semibold text-slate-900">{t("Skills Radar Comparison")}</h2>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <RadarChart data={radar} outerRadius="65%">
                    <PolarGrid stroke="#e2e8f0" />
                    <PolarAngleAxis dataKey="skill" tick={{ fontSize: 11, fill: "#475569" }} />
                    <PolarRadiusAxis domain={[0, 5]} tickCount={6} tick={false} axisLine={false} />
                    <Radar name={t("Self Score")} dataKey="Self" stroke="#176b55" fill="#52977a" fillOpacity={0.25} strokeWidth={2} />
                    <Radar name={t("External Score")} dataKey="External" stroke="#94a3b8" fill="#cbd5e1" fillOpacity={0.45} strokeWidth={2} />
                    <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                    <Tooltip />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="card p-6">
              <h2 className="font-semibold text-slate-900">{t("Milestone Progress")}</h2>
              <div className="mt-4 space-y-4">
                {data.milestones.map((m) => (
                  <div key={m.id}>
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-700">{t("Milestone {n} ({name})", { n: m.number, name: m.name })}</span>
                      <span className="text-slate-500">{m.progress}%</span>
                    </div>
                    <div className="mt-1.5 h-2 rounded-full bg-slate-100">
                      <div className="h-2 rounded-full bg-brand-500" style={{ width: `${m.progress}%` }} />
                    </div>
                    <div className="mt-1 text-[11px] text-slate-400">
                      {t("{self} · Peers given {given}/{total} · Received {received}/{min}+ · {instructor}", {
                        self: m.self_done ? t("Self ✓") : t("Self —"),
                        given: m.peers_given,
                        total: m.peers_total,
                        received: m.peers_received,
                        min: m.min_peers,
                        instructor: m.instructor_done ? t("Instructor ✓") : t("Instructor —"),
                      })}
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
                    {worst.level === "CRITICAL_GAP" ? t("Critical Blind Spot Detected (Δ > 2.0)") : t("Perception Gap Detected (Δ > 1.5)")}
                  </div>
                  <p className={`mt-1 text-sm ${worst.level === "CRITICAL_GAP" ? "text-red-600" : "text-amber-700"}`}>
                    {worst.direction === "overestimate" ? (
                      fill(t("Your self-assessment in {skill} ({self}) significantly exceeds the external evaluation by your peers and instructor ({external})."), { skill: <b>{t(worst.skill)}</b>, self: worst.self, external: fmt(worst.external) })
                    ) : (
                      fill(t("Others rate your {skill} ({external}) much higher than you rate yourself ({self}) — a hidden strength."), { skill: <b>{t(worst.skill)}</b>, self: worst.self, external: fmt(worst.external) })
                    )}{" "}
                    {t("The AI Engine has generated a developmental report for you.")}
                  </p>
                  <Link to={`/student/report?milestone=${latest.milestone.id}`} className="btn-outline mt-3 bg-white">{t("View AI Narrative Report")}</Link>
                </div>
              </div>
            </div>
          ) : (
            <Alert kind="success" title={t("Good alignment")}>{t("Your self-perception matches how your peers and instructor see you across all five skills.")}</Alert>
          )}

          {data.trend.length > 0 && (
            <div className="card p-6">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-brand-600" />
                <h2 className="font-semibold text-slate-900">{t("Blind Spot Trend Line")}</h2>
              </div>
              <p className="text-sm text-slate-500">{t("How your self-perception, external score and perception gap evolve across milestones.")}</p>
              <div className="mt-4 h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data.trend} margin={{ left: -20, right: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="milestone" tick={{ fontSize: 12 }} />
                    <YAxis domain={[0, 5]} tick={{ fontSize: 12 }} />
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Line type="monotone" dataKey="self" name={t("Self")} stroke="#176b55" strokeWidth={2} dot={{ r: 4 }} />
                    <Line type="monotone" dataKey="external" name={t("External (weighted)")} stroke="#a37944" strokeWidth={2} dot={{ r: 4 }} />
                    <Line type="monotone" dataKey="gap" name={t("Delta Δ")} stroke="#ef4444" strokeWidth={2} strokeDasharray="5 4" dot={{ r: 4 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          <div className="card overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-100">
              <thead className="bg-slate-50">
                <tr>
                  <th className="th">{t("Skill")}</th>
                  <th className="th">{t("Self")}</th>
                  <th className="th">{t("Peers")}</th>
                  <th className="th">{t("Instructor")}</th>
                  <th className="th">{t("External")}</th>
                  <th className="th">Δ</th>
                  <th className="th">{t("Status")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {latest.metrics.map((m) => (
                  <tr key={m.code}>
                    <td className="td font-medium">{t(m.skill)}</td>
                    <td className="td">{m.self}</td>
                    <td className="td">{fmt(m.peer_avg)}</td>
                    <td className="td">{m.instructor}</td>
                    <td className="td font-semibold text-brand-600">{fmt(m.external, 2)}</td>
                    <td className="td">{fmt(m.gap, 2)}</td>
                    <td className="td">
                      {m.level === "ALIGNED" ? (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600"><CheckCircle2 className="h-4 w-4" /> {t("Aligned")}</span>
                      ) : (
                        <span className={`badge ${m.level === "CRITICAL_GAP" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>
                          {m.direction === "overestimate" ? t("Blind spot") : t("Hidden strength")} · {m.level === "CRITICAL_GAP" ? t("Critical") : t("Moderate")}
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
