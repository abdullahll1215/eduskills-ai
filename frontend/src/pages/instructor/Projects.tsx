import { Plus, Trash2, UserMinus, UserPlus } from "lucide-react";
import { FormEvent, useState } from "react";
import { api } from "../../api/client";
import type { Milestone, User } from "../../api/types";
import { Alert, Empty, Loading, Modal, PageHeader, useFetch } from "../../components/ui";
import { useAuth } from "../../context/AuthContext";

interface ProjectFull {
  id: string;
  title: string;
  description: string | null;
  is_active: boolean;
  instructor: { id: string; full_name: string } | null;
  milestones: Milestone[];
  teams: { id: string; team_name: string; members: { id: string; full_name: string; student_number: string }[] }[];
  unassigned: { id: string; full_name: string }[];
}

export default function Projects() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const { data: projects, loading, error, reload } = useFetch(() => api<ProjectFull[]>("/api/projects"));
  const { data: instructors } = useFetch(() => (isAdmin ? api<User[]>("/api/admin/users", { params: { role: "instructor" } }) : Promise.resolve([])), [isAdmin]);
  const [selected, setSelected] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [newProject, setNewProject] = useState<{ title: string; description: string; instructor_id: string } | null>(null);
  const [enrollTeam, setEnrollTeam] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const { data: directory } = useFetch(() => (enrollTeam !== null ? api<User[]>("/api/projects/directory/students", { params: { q: search } }) : Promise.resolve([])), [enrollTeam, search]);
  const [teamName, setTeamName] = useState("");

  if (loading && !projects) return <Loading />;
  if (error) return <Alert kind="error">{error}</Alert>;

  const project = projects?.find((p) => p.id === selected) ?? projects?.[0];

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      setMsg({ kind: "success", text: ok });
      reload();
    } catch (e) {
      setMsg({ kind: "error", text: (e as Error).message });
    }
  };

  const createProject = async (e: FormEvent) => {
    e.preventDefault();
    if (!newProject) return;
    await run(async () => {
      const p = await api<ProjectFull>("/api/projects", { body: { ...newProject, instructor_id: newProject.instructor_id || null } });
      setSelected(p.id);
      setNewProject(null);
    }, "Project created with three default milestones.");
  };

  const updateMilestone = (m: Milestone, patch: Partial<Milestone>) =>
    run(() => api(`/api/projects/milestones/${m.id}`, { method: "PUT", body: { number: m.number, name: m.name, description: m.description, due_date: m.due_date, status: m.status, ...patch } }), "Milestone updated.");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Projects & Teams"
        subtitle="Configure projects, evaluation milestones (open/close evaluation periods), teams and enrollments."
        actions={<button className="btn-primary" onClick={() => setNewProject({ title: "", description: "", instructor_id: "" })}><Plus className="h-4 w-4" /> New project</button>}
      />
      {msg && <Alert kind={msg.kind} onClose={() => setMsg(null)}>{msg.text}</Alert>}
      {!project ? (
        <Empty title="No projects yet">Create your first project to begin.</Empty>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {projects!.map((p) => (
              <button key={p.id} onClick={() => setSelected(p.id)} className={`rounded-lg border px-4 py-2 text-sm font-medium ${p.id === project.id ? "border-brand-600 bg-brand-50 text-brand-700" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}>
                {p.title} {!p.is_active && "(inactive)"}
              </button>
            ))}
          </div>

          <div className="card p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">{project.title}</h2>
                <p className="text-sm text-slate-500">{project.description}</p>
                <p className="mt-1 text-xs text-slate-400">Instructor: {project.instructor?.full_name ?? "—"}</p>
              </div>
              <div className="flex gap-2">
                <button className="btn-outline" onClick={() => run(() => api(`/api/projects/${project.id}`, { method: "PUT", body: { title: project.title, description: project.description, is_active: !project.is_active, instructor_id: project.instructor?.id } }), "Project updated.")}>
                  {project.is_active ? "Deactivate" : "Activate"}
                </button>
                <button className="btn-ghost text-red-600" onClick={() => confirm(`Delete "${project.title}" and all its evaluations?`) && run(() => api(`/api/projects/${project.id}`, { method: "DELETE" }), "Project deleted.")}>
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>

            <h3 className="mt-6 font-semibold text-slate-800">Milestones</h3>
            <div className="mt-2 overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-100">
                <thead className="bg-slate-50"><tr><th className="th">#</th><th className="th">Name</th><th className="th">Due date</th><th className="th">Evaluation period</th><th className="th"></th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {project.milestones.map((m) => (
                    <tr key={m.id}>
                      <td className="td font-semibold">M{m.number}</td>
                      <td className="td">{m.name}</td>
                      <td className="td">
                        <input type="date" className="input w-auto py-1" value={m.due_date?.slice(0, 10) ?? ""} onChange={(e) => updateMilestone(m, { due_date: e.target.value ? `${e.target.value}T23:59:00` : null })} />
                      </td>
                      <td className="td">
                        <select className="input w-auto py-1" value={m.status} onChange={(e) => updateMilestone(m, { status: e.target.value as Milestone["status"] })}>
                          <option value="planned">Planned</option>
                          <option value="active">Active (open)</option>
                          <option value="closed">Closed</option>
                        </select>
                      </td>
                      <td className="td text-right">
                        <button className="btn-ghost p-1.5 text-red-500" onClick={() => confirm(`Delete M${m.number}?`) && run(() => api(`/api/projects/milestones/${m.id}`, { method: "DELETE" }), "Milestone deleted.")}><Trash2 className="h-4 w-4" /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button
              className="btn-outline mt-3"
              onClick={() => {
                const n = Math.max(0, ...project.milestones.map((m) => m.number)) + 1;
                const name = prompt(`Name for milestone M${n}:`, "Final Delivery");
                if (name) run(() => api(`/api/projects/${project.id}/milestones`, { body: { number: n, name, status: "planned" } }), "Milestone added.");
              }}
            >
              <Plus className="h-4 w-4" /> Add milestone
            </button>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {project.teams.map((t) => (
              <div key={t.id} className="card p-5">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-slate-900">{t.team_name} <span className="text-xs font-normal text-slate-400">({t.members.length} members)</span></h3>
                  <div className="flex gap-1">
                    <button className="btn-ghost p-1.5" title="Add member" onClick={() => setEnrollTeam(t.id)}><UserPlus className="h-4 w-4" /></button>
                    <button className="btn-ghost p-1.5 text-red-500" title="Delete team" onClick={() => confirm(`Delete ${t.team_name}?`) && run(() => api(`/api/projects/teams/${t.id}`, { method: "DELETE" }), "Team deleted.")}><Trash2 className="h-4 w-4" /></button>
                  </div>
                </div>
                {t.members.length < 4 && <p className="mt-1 text-xs text-amber-600">Anonymous peer evaluation needs at least 4 members (3 peers each).</p>}
                <ul className="mt-3 divide-y divide-slate-100">
                  {t.members.map((m) => (
                    <li key={m.id} className="flex items-center justify-between py-2 text-sm">
                      <span>{m.full_name} <span className="text-xs text-slate-400">{m.student_number}</span></span>
                      <button className="text-slate-400 hover:text-red-500" title="Remove from project" onClick={() => run(() => api(`/api/projects/${project.id}/enrollments/${m.id}`, { method: "DELETE" }), "Student removed.")}><UserMinus className="h-4 w-4" /></button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            <form
              className="card flex flex-col justify-center gap-2 border-dashed p-5"
              onSubmit={(e) => {
                e.preventDefault();
                if (teamName.trim()) run(() => api(`/api/projects/${project.id}/teams`, { body: { team_name: teamName } }), "Team created.").then(() => setTeamName(""));
              }}
            >
              <label className="label">New team</label>
              <div className="flex gap-2">
                <input className="input" value={teamName} onChange={(e) => setTeamName(e.target.value)} placeholder="Team Gamma" />
                <button className="btn-primary"><Plus className="h-4 w-4" /></button>
              </div>
            </form>
          </div>
          {project.unassigned.length > 0 && (
            <Alert kind="warning" title="Students without a team">{project.unassigned.map((u) => u.full_name).join(", ")}</Alert>
          )}
        </>
      )}

      <Modal open={!!newProject} title="New project" onClose={() => setNewProject(null)}>
        {newProject && (
          <form onSubmit={createProject} className="space-y-4">
            <div>
              <label className="label">Title</label>
              <input className="input" required value={newProject.title} onChange={(e) => setNewProject({ ...newProject, title: e.target.value })} />
            </div>
            <div>
              <label className="label">Description</label>
              <textarea className="input" value={newProject.description} onChange={(e) => setNewProject({ ...newProject, description: e.target.value })} />
            </div>
            {isAdmin && (
              <div>
                <label className="label">Instructor</label>
                <select className="input" value={newProject.instructor_id} onChange={(e) => setNewProject({ ...newProject, instructor_id: e.target.value })}>
                  <option value="">Me</option>
                  {instructors?.map((i) => <option key={i.id} value={i.id}>{i.full_name}</option>)}
                </select>
              </div>
            )}
            <div className="flex justify-end"><button className="btn-primary">Create</button></div>
          </form>
        )}
      </Modal>

      <Modal open={enrollTeam !== null} title="Add student to team" onClose={() => setEnrollTeam(null)}>
        <input className="input" placeholder="Search by name, email or student number" value={search} onChange={(e) => setSearch(e.target.value)} autoFocus />
        <ul className="mt-3 max-h-72 divide-y divide-slate-100 overflow-y-auto">
          {directory?.map((s) => (
            <li key={s.id} className="flex items-center justify-between py-2 text-sm">
              <span>{s.full_name} <span className="text-xs text-slate-400">{s.student_number}</span></span>
              <button
                className="btn-outline px-2 py-1 text-xs"
                onClick={() => project && run(() => api(`/api/projects/${project.id}/enrollments`, { body: { user_id: s.id, team_id: enrollTeam } }), `${s.full_name} added.`).then(() => setEnrollTeam(null))}
              >
                Add
              </button>
            </li>
          ))}
        </ul>
      </Modal>
    </div>
  );
}
