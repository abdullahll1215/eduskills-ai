import { useSearchParams } from "react-router-dom";
import { api } from "../../api/client";
import type { Milestone } from "../../api/types";
import { useFetch } from "../../components/ui";

export interface InstructorProject {
  id: string;
  title: string;
  is_active: boolean;
  milestones: Milestone[];
  student_count: number;
}

/** Selected project / milestone for instructor pages, persisted in the query string. */
export function useInstructorSelection() {
  const { data: projects, loading, error } = useFetch(() => api<InstructorProject[]>("/api/instructor/projects"));
  const [params, setParams] = useSearchParams();
  const project = projects?.find((p) => p.id === params.get("project")) ?? projects?.[0] ?? null;
  const milestoneId = params.get("milestone") ?? undefined;

  const set = (next: { project?: string; milestone?: string | null }) => {
    const p = new URLSearchParams(params);
    if (next.project) {
      p.set("project", next.project);
      p.delete("milestone");
    }
    if (next.milestone) p.set("milestone", next.milestone);
    else if (next.milestone === null) p.delete("milestone");
    setParams(p);
  };
  return { projects, project, milestoneId, loading, error, set };
}

export function ProjectPicker({ projects, value, onChange }: { projects: InstructorProject[]; value?: string; onChange: (id: string) => void }) {
  if (projects.length <= 1) return null;
  return (
    <select className="input w-auto" value={value} onChange={(e) => onChange(e.target.value)}>
      {projects.map((p) => (
        <option key={p.id} value={p.id}>{p.title}</option>
      ))}
    </select>
  );
}

export function MilestoneSelect({ milestones, value, onChange }: { milestones: Milestone[]; value?: string; onChange: (id: string) => void }) {
  return (
    <select className="input w-auto" value={value} onChange={(e) => onChange(e.target.value)}>
      {milestones.map((m) => (
        <option key={m.id} value={m.id}>
          M{m.number} · {m.name} {m.status === "active" ? "(open)" : m.status === "planned" ? "(planned)" : ""}
        </option>
      ))}
    </select>
  );
}
