import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../../api/client";
import type { MilestoneStatus, StudentProject } from "../../api/types";
import { useFetch } from "../../components/ui";

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
            M{m.number} · {m.name}
            {m.status === "active" && <span className={`h-2 w-2 rounded-full ${value === m.id ? "bg-white" : "bg-emerald-500"}`} title="Evaluation period open" />}
            {b && <span className={`text-xs ${value === m.id ? "text-brand-100" : "text-slate-400"}`}>{b}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function RatingSlider({ label, description, value, onChange, disabled, rubric }: { label: string; description?: string; value: number; onChange: (v: number) => void; disabled?: boolean; rubric?: Record<string, string> }) {
  return (
    <div className="py-3">
      <div className="grid items-center gap-3 sm:grid-cols-[180px_1fr]">
        <div>
          <div className="text-sm font-medium text-slate-800">{label}</div>
          {description && <div className="text-xs text-slate-400">{description}</div>}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-400">Poor</span>
          <input type="range" min={1} max={5} step={1} value={value} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))} className="h-2 flex-1 cursor-pointer" aria-label={label} />
          <span className="text-xs text-slate-400">Excellent</span>
          <span className="w-8 rounded-md bg-brand-50 py-0.5 text-center text-sm font-bold text-brand-700">{value}</span>
        </div>
      </div>
      {rubric?.[String(value)] && <div className="mt-1 text-xs text-slate-500 sm:ml-[192px]">{rubric[String(value)]}</div>}
    </div>
  );
}
