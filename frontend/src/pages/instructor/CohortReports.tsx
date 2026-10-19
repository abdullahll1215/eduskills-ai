import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../../api/client";
import type { Competency } from "../../api/types";
import { Alert, Empty, Loading, PageHeader, fmt, useFetch } from "../../components/ui";
import { useT } from "../../i18n";
import { ProjectPicker, useInstructorSelection } from "./shared";

interface CohortData {
  project: { id: string; title: string };
  competencies: Competency[];
  milestones: {
    milestone: string;
    name: string;
    reports: number;
    avg_self: number;
    avg_external: number;
    avg_gap: number;
    levels: Record<string, number>;
    skills: Record<string, { name: string; self: number; external: number; gap: number; blind_spots: number }>;
  }[];
  teams: { team: string; members: number; avg_external: number | null; critical: number; moderate: number }[];
}

const SKILL_COLORS = ["#4f46e5", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444"];

export default function CohortReports() {
  const t = useT();
  const sel = useInstructorSelection();
  const [perceptionMs, setPerceptionMs] = useState<string | null>(null);
  const { data, loading, error } = useFetch(
    () => (sel.project ? api<CohortData>("/api/instructor/cohort-report", { params: { project_id: sel.project.id } }) : Promise.resolve(null)),
    [sel.project?.id],
  );

  if (sel.loading || (loading && !data)) return <Loading />;
  if (sel.error || error) return <Alert kind="error">{sel.error || error}</Alert>;
  if (!data) return <Empty title={t("No projects yet")} />;

  const most = Math.max(0, ...data.milestones.map((m) => m.reports));
  const defaultMs = [...data.milestones].reverse().find((m) => m.reports === most)?.milestone;
  const latest = data.milestones.find((m) => m.milestone === (perceptionMs ?? defaultMs));
  const trend = data.milestones.map((m) => ({ milestone: m.milestone, ...Object.fromEntries(Object.entries(m.skills).map(([k, v]) => [k, v.external])) }));
  const gaps = latest ? Object.entries(latest.skills).map(([, v]) => ({ skill: t(v.name), Self: v.self, External: v.external, "Blind spots": v.blind_spots })) : [];
  const levels = data.milestones.map((m) => ({ milestone: m.milestone, Aligned: m.levels.ALIGNED, Moderate: m.levels.MODERATE_GAP, Critical: m.levels.CRITICAL_GAP }));

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("Cohort Reports")}
        subtitle={t("{project} — systemic skill weaknesses and growth across milestones.", { project: data.project.title })}
        actions={<ProjectPicker projects={sel.projects ?? []} value={sel.project?.id} onChange={(id) => sel.set({ project: id })} />}
      />
      {data.milestones.length === 0 ? (
        <Empty title={t("No completed reports yet")}>{t("Cohort analytics appear once the first 360° cycle is complete.")}</Empty>
      ) : (
        <>
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="card p-6">
              <h2 className="font-semibold text-slate-900">{t("Cohort skill growth (external score)")}</h2>
              <div className="mt-4 h-72">
                <ResponsiveContainer>
                  <LineChart data={trend} margin={{ left: -20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="milestone" />
                    <YAxis domain={[1, 5]} />
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    {data.competencies.map((c, i) => (
                      <Line key={c.code} type="monotone" dataKey={c.code} name={t(c.skill_name)} stroke={SKILL_COLORS[i % 5]} strokeWidth={2} />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="card p-6">
              <h2 className="font-semibold text-slate-900">{t("Blind-spot distribution")}</h2>
              <div className="mt-4 h-72">
                <ResponsiveContainer>
                  <BarChart data={levels} margin={{ left: -20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="milestone" />
                    <YAxis allowDecimals={false} />
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="Aligned" name={t("Aligned")} stackId="a" fill="#10b981" />
                    <Bar dataKey="Moderate" name={t("Moderate")} stackId="a" fill="#f59e0b" />
                    <Bar dataKey="Critical" name={t("Critical")} stackId="a" fill="#ef4444" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {latest && (
            <div className="card p-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-semibold text-slate-900">{t("Self vs external perception by skill")}</h2>
                <select className="input w-auto py-1" value={latest.milestone} onChange={(e) => setPerceptionMs(e.target.value)}>
                  {data.milestones.map((m) => <option key={m.milestone} value={m.milestone}>{t("{milestone} · {name} ({n} reports)", { milestone: m.milestone, name: m.name, n: m.reports })}</option>)}
                </select>
              </div>
              <div className="mt-4 h-72">
                <ResponsiveContainer>
                  <BarChart data={gaps} margin={{ left: -20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="skill" tick={{ fontSize: 12 }} />
                    <YAxis domain={[0, 5]} ticks={[0, 1, 2, 3, 4, 5]} />
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="Self" name={t("Self")} fill="#6366f1" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="External" name={t("External")} fill="#94a3b8" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          <div className="grid gap-6 lg:grid-cols-2">
            <div className="card overflow-x-auto">
              <div className="px-5 pt-5 font-semibold text-slate-900">{t("Milestone summary")}</div>
              <table className="mt-3 min-w-full divide-y divide-slate-100">
                <thead className="bg-slate-50"><tr><th className="th">{t("MS")}</th><th className="th">{t("Reports")}</th><th className="th">{t("Avg self")}</th><th className="th">{t("Avg ext.")}</th><th className="th">{t("Avg Δ")}</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {data.milestones.map((m) => (
                    <tr key={m.milestone}><td className="td font-medium">{m.milestone} · {m.name}</td><td className="td">{m.reports}</td><td className="td">{fmt(m.avg_self, 2)}</td><td className="td">{fmt(m.avg_external, 2)}</td><td className="td">{fmt(m.avg_gap, 2)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="card overflow-x-auto">
              <div className="px-5 pt-5 font-semibold text-slate-900">{t("Teams (latest milestone per student)")}</div>
              <table className="mt-3 min-w-full divide-y divide-slate-100">
                <thead className="bg-slate-50"><tr><th className="th">{t("Team")}</th><th className="th">{t("Members")}</th><th className="th">{t("Avg ext.")}</th><th className="th">{t("Moderate")}</th><th className="th">{t("Critical")}</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {data.teams.map((tm) => (
                    <tr key={tm.team} className={tm.critical ? "bg-red-50/50" : ""}><td className="td font-medium">{tm.team}</td><td className="td">{tm.members}</td><td className="td">{fmt(tm.avg_external, 2)}</td><td className="td">{tm.moderate}</td><td className="td font-semibold text-red-600">{tm.critical}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
