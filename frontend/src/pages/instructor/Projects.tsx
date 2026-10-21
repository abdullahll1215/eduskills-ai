import { Plus, Trash2, UserMinus, UserPlus } from "lucide-react";
import { FormEvent, useState } from "react";
import { api } from "../../api/client";
import type { Milestone, User } from "../../api/types";
import { Alert, askConfirm, askText, Empty, Loading, Modal, PageHeader, useFetch } from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import { useT } from "../../i18n";
import CoursePicker from "../../components/CoursePicker";
import { courseByCode } from "../../data/courseCatalog";
import CourseInstructorAssignment from "../../components/CourseInstructorAssignment";
import { CopyCode } from "../student/TeamSetup";

interface ProjectFull {
  id: string;
  title: string;
  description: string | null;
  is_active: boolean;
  join_code: string | null;
  instructor: { id: string; full_name: string } | null;
  milestones: Milestone[];
  teams: { id: string; team_name: string; invite_code: string | null; members: { id: string; full_name: string; student_number: string }[] }[];
  unassigned: { id: string; full_name: string }[];
}

export default function Projects() {
  const t = useT();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const { data: projects, loading, error, reload } = useFetch(() => api<ProjectFull[]>("/api/projects"));
  const { data: instructors } = useFetch(() => (isAdmin ? api<User[]>("/api/admin/users", { params: { role: "instructor" } }) : Promise.resolve([])), [isAdmin]);
  const [selected, setSelected] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [newProject, setNewProject] = useState<{ title: string; description: string; instructor_id: string; course_number: string } | null>(null);
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
      const p = await api<ProjectFull>("/api/projects", { body: { ...newProject, course_number: newProject.course_number || null, instructor_id: newProject.instructor_id || null } });
      setSelected(p.id);
      setNewProject(null);
    }, t("Project created with three default milestones."));
  };

  const updateMilestone = (m: Milestone, patch: Partial<Milestone>) =>
    run(() => api(`/api/projects/milestones/${m.id}`, { method: "PUT", body: { number: m.number, name: m.name, description: m.description, due_date: m.due_date, status: m.status, ...patch } }), t("Milestone updated."));

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("Projects & Teams")}
        subtitle={t("Configure projects, evaluation milestones (open/close evaluation periods), teams and enrollments.")}
        actions={<button className="btn-primary" onClick={() => setNewProject({ title: "", description: "", instructor_id: "", course_number: "" })}><Plus className="h-4 w-4" /> {t("New project")}</button>}
      />
      {msg && <Alert kind={msg.kind} onClose={() => setMsg(null)}>{msg.text}</Alert>}
      {!project ? (
        <Empty title={t("No projects yet")}>{t("Create your first project to begin.")}</Empty>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {projects!.map((p) => (
              <button key={p.id} onClick={() => setSelected(p.id)} className={`rounded-lg border px-4 py-2 text-sm font-medium ${p.id === project.id ? "border-brand-600 bg-brand-50 text-brand-700" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}>
                {p.title} {!p.is_active && t("(inactive)")} {!p.instructor && <span className="ms-2 inline-flex items-center gap-1.5 text-xs text-amber-800"><span className="h-1.5 w-1.5 rounded-full bg-amber-600" />{t("Needs instructor")}</span>}
              </button>
            ))}
          </div>

          <div className="card p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">{project.title}</h2>
                <p className="text-sm text-slate-500">{project.description}</p>
                <p className="mt-1 text-xs text-slate-400">{t("Instructor: {name}", { name: project.instructor?.full_name ?? "—" })}</p>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  {t("Course number")} {project.join_code && <CopyCode code={project.join_code} />}
                  <button
                    className="btn-ghost px-2 py-1 text-xs"
                    onClick={async () => {
                      const number = await askText(t("Course number (4 to 10 digits):"), project.join_code ?? "");
                      if (number) run(() => api(`/api/projects/${project.id}`, { method: "PUT", body: { title: project.title, description: project.description, is_active: project.is_active, instructor_id: project.instructor?.id, course_number: number.trim() } }), t("Course number saved."));
                    }}
                  >
                    {t("Edit")}
                  </button>
                  <span>{t("Students type it to create a team in this course.")}</span>
                </div>
              </div>
              <div className="flex gap-2">
                <button className="btn-outline" onClick={() => run(() => api(`/api/projects/${project.id}`, { method: "PUT", body: { title: project.title, description: project.description, is_active: !project.is_active, instructor_id: project.instructor?.id } }), t("Project updated."))}>
                  {project.is_active ? t("Deactivate") : t("Activate")}
                </button>
                <button className="btn-ghost text-red-600" onClick={async () => (await askConfirm(t("Delete \"{title}\" and all its evaluations?", { title: project.title }))) && run(() => api(`/api/projects/${project.id}`, { method: "DELETE" }), t("Project deleted."))}>
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>

            {isAdmin && <CourseInstructorAssignment key={`${project.id}:${project.instructor?.id ?? "none"}`} projectId={project.id} currentId={project.instructor?.id ?? null} instructors={instructors ?? []} onSaved={() => { setMsg({ kind: "success", text: t("Instructor assigned. Teams and assessments are unchanged.") }); reload(); }} />}

            <h3 className="mt-6 font-semibold text-slate-800">{t("Milestones")}</h3>
            <div className="mt-2 overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-100">
                <thead className="bg-slate-50"><tr><th className="th">#</th><th className="th">{t("Name")}</th><th className="th">{t("Due date")}</th><th className="th">{t("Evaluation period")}</th><th className="th"></th></tr></thead>
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
                          <option value="planned">{t("Planned")}</option>
                          <option value="active">{t("Active (open)")}</option>
                          <option value="closed">{t("Closed")}</option>
                        </select>
                      </td>
                      <td className="td text-end">
                        <button className="btn-ghost p-1.5 text-red-500" onClick={async () => (await askConfirm(t("Delete M{n}?", { n: m.number }))) && run(() => api(`/api/projects/milestones/${m.id}`, { method: "DELETE" }), t("Milestone deleted."))}><Trash2 className="h-4 w-4" /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button
              className="btn-outline mt-3"
              onClick={async () => {
                const n = Math.max(0, ...project.milestones.map((m) => m.number)) + 1;
                const name = await askText(t("Name for milestone M{n}:", { n }), t("Final Delivery"));
                if (name) run(() => api(`/api/projects/${project.id}/milestones`, { body: { number: n, name, status: "planned" } }), t("Milestone added."));
              }}
            >
              <Plus className="h-4 w-4" /> {t("Add milestone")}
            </button>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {project.teams.map((tm) => (
              <div key={tm.id} className="card p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold text-slate-900">{tm.team_name} <span className="text-xs font-normal text-slate-400">{t("({n} members)", { n: tm.members.length })}</span></h3>
                    {tm.invite_code && <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">{t("Invite code")} <span className="font-mono font-semibold tracking-widest text-brand-700" dir="ltr">{tm.invite_code}</span></div>}
                  </div>
                  <div className="flex gap-1">
                    <button className="btn-ghost p-1.5" title={t("Add member")} onClick={() => setEnrollTeam(tm.id)}><UserPlus className="h-4 w-4" /></button>
                    <button className="btn-ghost p-1.5 text-red-500" title={t("Delete team")} onClick={async () => (await askConfirm(t("Delete {name}?", { name: tm.team_name }))) && run(() => api(`/api/projects/teams/${tm.id}`, { method: "DELETE" }), t("Team deleted."))}><Trash2 className="h-4 w-4" /></button>
                  </div>
                </div>
                {tm.members.length < 4 && <p className="mt-1 text-xs text-amber-600">{t("Anonymous peer evaluation needs at least 4 members (3 peers each).")}</p>}
                <ul className="mt-3 divide-y divide-slate-100">
                  {tm.members.map((m) => (
                    <li key={m.id} className="flex items-center justify-between py-2 text-sm">
                      <span>{m.full_name} <span className="text-xs text-slate-400">{m.student_number}</span></span>
                      <button className="text-slate-400 hover:text-red-500" title={t("Remove from project")} onClick={() => run(() => api(`/api/projects/${project.id}/enrollments/${m.id}`, { method: "DELETE" }), t("Student removed."))}><UserMinus className="h-4 w-4" /></button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            <form
              className="card flex flex-col justify-center gap-2 border-dashed p-5"
              onSubmit={(e) => {
                e.preventDefault();
                if (teamName.trim()) run(() => api(`/api/projects/${project.id}/teams`, { body: { team_name: teamName } }), t("Team created.")).then(() => setTeamName(""));
              }}
            >
              <label className="label">{t("New team")}</label>
              <div className="flex gap-2">
                <input className="input" value={teamName} onChange={(e) => setTeamName(e.target.value)} placeholder={t("Team Gamma")} />
                <button className="btn-primary"><Plus className="h-4 w-4" /></button>
              </div>
            </form>
          </div>
          {project.unassigned.length > 0 && (
            <Alert kind="warning" title={t("Students without a team")}>{project.unassigned.map((u) => u.full_name).join(t(", "))}</Alert>
          )}
        </>
      )}

      <Modal open={!!newProject} title={t("New project")} onClose={() => setNewProject(null)}>
        {newProject && (
          <form onSubmit={createProject} className="space-y-4">
            <CoursePicker code={newProject.course_number} required={false} onChange={code => setNewProject({ ...newProject, course_number: code, title: courseByCode(code)?.name_en ?? newProject.title })} />
            <div>
              <label className="label">{t("Title")}</label>
              <input className="input" required value={newProject.title} onChange={(e) => setNewProject({ ...newProject, title: e.target.value })} />
            </div>
            <div>
              <label className="label">{t("Description")}</label>
              <textarea className="input" value={newProject.description} onChange={(e) => setNewProject({ ...newProject, description: e.target.value })} />
            </div>
            {isAdmin && (
              <div>
                <label className="label">{t("Instructor")}</label>
                <select className="input" value={newProject.instructor_id} onChange={(e) => setNewProject({ ...newProject, instructor_id: e.target.value })}>
                  <option value="">{t("Me")}</option>
                  {instructors?.map((i) => <option key={i.id} value={i.id}>{i.full_name}</option>)}
                </select>
              </div>
            )}
            <div className="flex justify-end"><button className="btn-primary">{t("Create")}</button></div>
          </form>
        )}
      </Modal>

      <Modal open={enrollTeam !== null} title={t("Add student to team")} onClose={() => setEnrollTeam(null)}>
        <input className="input" placeholder={t("Search by name, email or student number")} value={search} onChange={(e) => setSearch(e.target.value)} autoFocus />
        <ul className="mt-3 max-h-72 divide-y divide-slate-100 overflow-y-auto">
          {directory?.map((s) => (
            <li key={s.id} className="flex items-center justify-between py-2 text-sm">
              <span>{s.full_name} <span className="text-xs text-slate-400">{s.student_number}</span></span>
              <button
                className="btn-outline px-2 py-1 text-xs"
                onClick={() => project && run(() => api(`/api/projects/${project.id}/enrollments`, { body: { user_id: s.id, team_id: enrollTeam } }), t("{name} added.", { name: s.full_name })).then(() => setEnrollTeam(null))}
              >
                {t("Add")}
              </button>
            </li>
          ))}
        </ul>
      </Modal>
    </div>
  );
}
