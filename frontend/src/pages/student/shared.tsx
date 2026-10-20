import { Fragment, ReactNode, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../../api/client";
import type { MilestoneStatus, StudentProject } from "../../api/types";
import { useFetch } from "../../components/ui";
import { useT } from "../../i18n";

/** Fills {name} placeholders in an already-translated string with React nodes (e.g. bold text). */
export function fill(template: string, parts: Record<string, ReactNode>): ReactNode {
  return template.split(/(\{\w+\})/g).map((seg, i) => {
    const m = seg.match(/^\{(\w+)\}$/);
    return m && m[1] in parts ? <Fragment key={i}>{parts[m[1]]}</Fragment> : seg;
  });
}

/** Loads the student's projects and keeps the selected milestone in the URL (?milestone=...). */
export function useStudentMilestone(prefer: "active" | "latest-report" = "active") {
  const { data: projects, loading, error, reload } = useFetch(() => api<StudentProject[]>("/api/student/projects"));
  const [params, setParams] = useSearchParams();
  const project = projects?.[0] ?? null;
  const milestones = project?.milestones ?? [];
  const requested = params.get("milestone");

  let milestone: MilestoneStatus | null = milestones.find((m) => m.id === requested) ?? null;
  if (!milestone && milestones.length) {
    if (prefer === "latest-report") milestone = [...milestones].reverse().find((m) => m.report_id) ?? milestones[0];
    else milestone = milestones.find((m) => m.status === "active") ?? milestones[milestones.length - 1];
  }

  useEffect(() => {
    if (milestone && milestone.id !== requested) setParams({ milestone: milestone.id }, { replace: true });
  }, [milestone, requested, setParams]);

  const select = (id: string) => setParams({ milestone: id });
  return { projects, project, milestones, milestone, loading, error, reload, select };
}

export function MilestoneTabs({ milestones, value, onChange, badge }: { milestones: MilestoneStatus[]; value?: string; onChange: (id: string) => void; badge?: (m: MilestoneStatus) => string | null }) {
  const t = useT();
  return (
    <div className="mb-6 inline-flex flex-wrap gap-1 rounded-xl border border-slate-200 bg-white p-1">
      {milestones.map((m) => {
        const b = badge?.(m);
        return (
          <button
            key={m.id}
            onClick={() => onChange(m.id)}
            className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition ${value === m.id ? "bg-brand-600 text-white" : "text-slate-600 hover:bg-slate-100"}`}
          >
            {t("M{n} · {name}", { n: m.number, name: m.name })}
            {m.status === "active" && <span className={`h-2 w-2 rounded-full ${value === m.id ? "bg-white" : "bg-emerald-500"}`} title={t("Evaluation period open")} />}
            {b && <span className={`text-xs ${value === m.id ? "text-brand-100" : "text-slate-400"}`}>{b}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function RatingSlider({ label, description, value, onChange, disabled, rubric }: { label: string; description?: string; value: number; onChange: (v: number) => void; disabled?: boolean; rubric?: Record<string, string> }) {
  const t = useT();
  return (
    <div className="skill-rating">
      <div className="skill-rating-grid">
        <div>
          <div className="skill-rating-label">{label}</div>
          {description && <div className="mt-1 text-xs text-slate-500">{description}</div>}
        </div>
        <div className="skill-rating-scale">
          <span className="skill-rating-end">{t("Poor")}</span>
          <input type="range" min={1} max={5} step={1} value={value} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))} className="skill-range" aria-label={label} aria-valuetext={`${value} / 5`} />
          <span className="skill-rating-end">{t("Excellent")}</span>
          <span className="skill-rating-value" dir="ltr">{value}<small>/5</small></span>
        </div>
      </div>
      {rubric?.[String(value)] && <div className="skill-rating-rubric">{t(rubric[String(value)])}</div>}
    </div>
  );
}
