import { ArrowLeft, ChevronRight, Crown, ExternalLink, FilePlus2, FolderKanban, FolderPlus, GitCommitHorizontal, LogOut, Search, Trash2, Upload, UserPlus, Users, X } from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../../api/client";
import type { StudentProject } from "../../api/types";
import { Alert, Empty, Loading, Modal, PageHeader, askConfirm, fmtDate, useFetch } from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import { useT } from "../../i18n";
import { fill } from "./shared";
import TeamSection from "./TeamSetup";

interface ArtifactRow {
  id: string;
  milestone_id: string;
  stage: number;
  kind: string;
  title: string;
  url: string | null;
  metrics: Record<string, number | string | boolean | null>;
  created_at: string;
  added_by?: string | null;
  is_mine?: boolean;
}

interface Person {
  id: string;
  full_name: string;
  student_number: string | null;
}

interface WorkProject {
  id: string;
  name: string;
  description: string | null;
  url: string | null;
  stages: number;
  created_at: string;
  updated_at: string;
  file_count: number;
  is_owner: boolean;
  owner: Person | null;
  members: Person[];
  files?: ArtifactRow[];
}

const METRIC_LABELS: Record<string, string> = {
  commit_count: "Commits",
  active_days: "Active days",
  consistency: "Consistency",
  last_minute_ratio: "Last-minute ratio",
  avg_hours_between_commits: "Avg hours between commits",
  hours_before_due: "Hours before due",
  on_time: "On time",
  commits_after_due: "Commits after due",
};

const KIND_LABELS: Record<string, string> = {
  git_log: "Git commit log",
  submission: "Deliverable submission",
  link: "Link / document",
};

/** New files are recorded against the open evaluation period, so indicators use its due date. */
function useCurrentMilestoneId() {
  const { data } = useFetch(() => api<StudentProject[]>("/api/student/projects"));
  const milestones = data?.[0]?.milestones ?? [];
  return (milestones.find((m) => m.status === "active") ?? milestones[milestones.length - 1])?.id ?? null;
}

/** Search students by name or university ID and collect them as removable chips. */
function StudentPicker({ value, onChange, exclude = [] }: { value: Person[]; onChange: (v: Person[]) => void; exclude?: string[] }) {
  const t = useT();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<Person[]>([]);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      api<Person[]>("/api/student/work-projects/candidates", { params: { q } }).then(setResults).catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(timer);
  }, [q]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const hidden = new Set([...exclude, ...value.map((p) => p.id)]);
  const shown = results.filter((p) => !hidden.has(p.id));

  return (
    <div ref={box} className="space-y-2">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((p) => (
            <span key={p.id} className="inline-flex items-center gap-1 rounded-full bg-brand-50 py-1 pe-1.5 ps-3 text-xs font-medium text-brand-700">
              {p.full_name}
              <button type="button" onClick={() => onChange(value.filter((x) => x.id !== p.id))} className="rounded-full p-0.5 hover:bg-brand-100" aria-label={t("Remove {name}", { name: p.full_name })}>
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="relative">
        <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          className="input ps-9"
          dir="auto"
          value={q}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          placeholder={t("Search students by name or university ID...")}
        />
        {open && (
          <div className="card absolute z-30 mt-1 max-h-56 w-full overflow-y-auto py-1">
            {shown.length === 0 && <div className="px-4 py-3 text-sm text-slate-500">{t("No students found.")}</div>}
            {shown.map((p) => (
              <button
                key={p.id}
                type="button"
                className="flex w-full items-center justify-between gap-3 px-4 py-2 text-start hover:bg-slate-50"
                onClick={() => {
                  onChange([...value, p]);
                  setQ("");
                  setOpen(false);
                }}
              >
                <span className="text-sm text-slate-800">{p.full_name}</span>
                <span className="text-xs text-slate-400">{p.student_number}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AddMemberForm({ projects, initialProjectId, onDone }: { projects: WorkProject[]; initialProjectId: string; onDone: (projectId: string) => void }) {
  const t = useT();
  const [projectId, setProjectId] = useState(initialProjectId || projects[0]?.id || "");
  const [people, setPeople] = useState<Person[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const project = projects.find((p) => p.id === projectId);
  const exclude = project ? [project.owner?.id ?? "", ...project.members.map((m) => m.id)] : [];

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!people.length) return setError(t("Choose at least one student."));
    setBusy(true);
    try {
      await api(`/api/student/work-projects/${projectId}/members`, { body: { student_ids: people.map((p) => p.id) } });
      onDone(projectId);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      {error && <Alert kind="error" onClose={() => setError(null)}>{error}</Alert>}
      <div>
        <label className="label">{t("Project")}</label>
        <select className="input" value={projectId} onChange={(e) => { setProjectId(e.target.value); setPeople([]); }}>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>
      <div>
        <label className="label">{t("Students")}</label>
        <StudentPicker value={people} onChange={setPeople} exclude={exclude} />
      </div>
      <button className="btn-primary w-full" disabled={busy || !projectId}><UserPlus className="h-4 w-4" /> {t("Add to project")}</button>
    </form>
  );
}

function ProjectForm({ onCreated }: { onCreated: (wp: WorkProject) => void }) {
  const t = useT();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [url, setUrl] = useState("");
  const [stages, setStages] = useState(1);
  const [team, setTeam] = useState<Person[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      onCreated(await api<WorkProject>("/api/student/work-projects", { body: { name, description, url: url.trim() || null, stages, member_ids: team.map((p) => p.id) } }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      {error && <Alert kind="error" onClose={() => setError(null)}>{error}</Alert>}
      <div>
        <label className="label">{t("Project name")}</label>
        <input className="input" required value={name} onChange={(e) => setName(e.target.value)} placeholder={t("e.g. Graduation project, Mobile app")} autoFocus />
      </div>
      <div>
        <label className="label">{t("Description (optional)")}</label>
        <textarea className="input min-h-[90px]" value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t("What is the project about and what is your role in it?")} />
      </div>
      <div>
        <label className="label">{t("Project link (optional)")}</label>
        <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://github.com/team/repo" />
      </div>
      <div>
        <label className="label">{t("Number of stages")}</label>
        <p className="mb-2 text-xs text-slate-500">{t("How many stages will you complete this project in?")}</p>
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t("Number of stages")}>
          {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={stages === n}
              onClick={() => setStages(n)}
              className={`h-9 w-9 rounded-lg border text-sm font-semibold transition ${stages === n ? "border-brand-600 bg-brand-600 text-white" : "border-slate-200 text-slate-600 hover:border-brand-300 hover:bg-brand-50"}`}
            >
              {n}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="label">{t("Add team (optional)")}</label>
        <p className="mb-2 text-xs text-slate-500">{t("Students you add will see this project and can add files to it.")}</p>
        <StudentPicker value={team} onChange={setTeam} />
      </div>
      <button className="btn-primary w-full" disabled={busy}><FolderPlus className="h-4 w-4" /> {t("Add project")}</button>
    </form>
  );
}

function FileForm({ projectId, milestoneId, stages, initialStage, onAdded }: { projectId: string; milestoneId: string | null; stages: number; initialStage: number; onAdded: () => void }) {
  const t = useT();
  const [stage, setStage] = useState(initialStage);
  const [kind, setKind] = useState<"git_log" | "submission" | "link">("git_log");
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [gitLog, setGitLog] = useState("");
  const [submittedAt, setSubmittedAt] = useState("");
  const [error, setError] = useState<string | null>(null);

  const onFile = async (file?: File) => {
    if (file) setGitLog(await file.text());
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!milestoneId) return setError(t("You need to join a project team before adding files."));
    try {
      await api("/api/student/artifacts", {
        body: { milestone_id: milestoneId, work_project_id: projectId, stage, kind, title, url: url || null, git_log: kind === "git_log" ? gitLog : null, submitted_at: kind === "submission" && submittedAt ? submittedAt : null },
      });
      onAdded();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      {error && <Alert kind="error" onClose={() => setError(null)}>{error}</Alert>}
      {stages > 1 && (
        <div>
          <label className="label">{t("Stage")}</label>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t("Stage")}>
            {Array.from({ length: stages }, (_, i) => i + 1).map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={stage === n}
                onClick={() => setStage(n)}
                className={`h-9 min-w-[2.25rem] rounded-lg border px-2 text-sm font-semibold transition ${stage === n ? "border-brand-600 bg-brand-600 text-white" : "border-slate-200 text-slate-600 hover:border-brand-300 hover:bg-brand-50"}`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
      )}
      <div>
        <label className="label">{t("File type")}</label>
        <select className="input" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
          <option value="git_log">{t(KIND_LABELS.git_log)}</option>
          <option value="submission">{t(KIND_LABELS.submission)}</option>
          <option value="link">{t(KIND_LABELS.link)}</option>
        </select>
      </div>
      <div>
        <label className="label">{t("Title")}</label>
        <input className="input" required value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("e.g. Backend repository")} />
      </div>
      <div>
        <label className="label">{t("URL (optional)")}</label>
        <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://github.com/team/repo" />
      </div>
      {kind === "git_log" && (
        <div>
          <label className="label">{t("Commit log")}</label>
          <p className="mb-2 text-xs text-slate-500">
            {fill(t("Run {command} and paste the output or upload the file."), {
              command: <code className="rounded bg-slate-100 px-1" dir="ltr">git log --pretty=format:"%H|%an|%aI|%s" --author="you"</code>,
            })}
          </p>
          <textarea className="input min-h-[120px] font-mono text-xs" value={gitLog} onChange={(e) => setGitLog(e.target.value)} required />
          <label className="btn-outline mt-2 cursor-pointer text-xs">
            <Upload className="h-3.5 w-3.5" /> {t("Upload .txt")}
            <input type="file" accept=".txt,.log,.csv" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
          </label>
        </div>
      )}
      {kind === "submission" && (
        <div>
          <label className="label">{t("Submitted at")}</label>
          <input type="datetime-local" className="input" value={submittedAt} onChange={(e) => setSubmittedAt(e.target.value)} />
        </div>
      )}
      <button className="btn-primary w-full"><FilePlus2 className="h-4 w-4" /> {t("Add file")}</button>
    </form>
  );
}

function FileCard({ a, onDelete }: { a: ArtifactRow; onDelete: () => void }) {
  const t = useT();
  return (
    <div className="card p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <GitCommitHorizontal className="h-5 w-5 text-brand-600" />
          <div>
            <div className="font-semibold text-slate-800">{a.title}</div>
            <div className="text-xs text-slate-400">
              {KIND_LABELS[a.kind] ? t(KIND_LABELS[a.kind]) : a.kind.replace("_", " ")} · {fmtDate(a.created_at)}
              {a.is_mine === false && a.added_by && <> · {t("Added by {name}", { name: a.added_by })}</>}
            </div>
          </div>
        </div>
        <div className="flex gap-1">
          {a.url && <a href={a.url} target="_blank" rel="noreferrer" className="btn-ghost p-2" aria-label={t("Open link")}><ExternalLink className="h-4 w-4" /></a>}
          {a.is_mine !== false && <button onClick={onDelete} className="btn-ghost p-2 text-red-500" aria-label={t("Delete")}><Trash2 className="h-4 w-4" /></button>}
        </div>
      </div>
      {Object.keys(a.metrics).length > 0 && (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {Object.entries(a.metrics)
            .filter(([k]) => METRIC_LABELS[k])
            .map(([k, v]) => (
              <div key={k} className="rounded-lg bg-slate-50 px-3 py-2">
                <div className="text-[11px] text-slate-500">{t(METRIC_LABELS[k])}</div>
                <div className="text-sm font-semibold text-slate-800">
                  {typeof v === "boolean" ? (v ? t("Yes") : t("No")) : k.includes("ratio") || k === "consistency" ? `${Math.round(Number(v) * 100)}%` : String(v)}
                </div>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

function ProjectDetail({ id, version, onBack, onChanged, onAddMember }: { id: string; version: number; onBack?: () => void; onChanged: (deleted?: boolean) => void; onAddMember: () => void }) {
  const t = useT();
  const { data, loading, error, reload } = useFetch(() => api<WorkProject>(`/api/student/work-projects/${id}`), [id, version]);
  const milestoneId = useCurrentMilestoneId();
  const { user } = useAuth();
  // The stage the add-file window opens on; null = closed.
  const [adding, setAdding] = useState<number | null>(null);

  if (loading && !data) return <Loading />;
  if (error) return <Alert kind="error">{error}</Alert>;
  if (!data) return null;

  const removeFile = async (fileId: string) => {
    if (!(await askConfirm(t("Delete this file?")))) return;
    await api(`/api/student/artifacts/${fileId}`, { method: "DELETE" });
    reload();
    onChanged();
  };

  const removeProject = async () => {
    if (!(await askConfirm(t('Delete "{name}" and all of its files?', { name: data.name })))) return;
    await api(`/api/student/work-projects/${id}`, { method: "DELETE" });
    onChanged(true);
  };

  const removeMember = async (m: Person) => {
    const leaving = m.id === user?.id;
    if (!(await askConfirm(leaving ? t('Leave "{name}"?', { name: data.name }) : t("Remove {name} from this project?", { name: m.full_name })))) return;
    await api(`/api/student/work-projects/${id}/members/${m.id}`, { method: "DELETE" });
    if (leaving) onChanged(true);
    else {
      reload();
      onChanged();
    }
  };

  return (
    <div className="space-y-6">
      {onBack && (
        <button className="btn-ghost -ms-2 text-sm" onClick={onBack}><ArrowLeft className="h-4 w-4 rtl:rotate-180" /> {t("All projects")}</button>
      )}
      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <div className="card h-fit p-6">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-brand-50 p-2.5"><FolderKanban className="h-6 w-6 text-brand-600" /></div>
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-slate-900">{data.name}</h2>
              <div className="text-xs text-slate-400">{t("Created {date}", { date: fmtDate(data.created_at) })}</div>
            </div>
          </div>
          {data.description && <p className="mt-4 whitespace-pre-line text-sm text-slate-600">{data.description}</p>}
          <dl className="mt-4 space-y-2 border-t border-slate-100 pt-4 text-sm">
            <div className="flex justify-between"><dt className="text-slate-500">{t("Stages")}</dt><dd className="font-semibold text-slate-800">{data.stages}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">{t("Files")}</dt><dd className="font-semibold text-slate-800">{data.file_count}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">{t("Last update")}</dt><dd className="font-semibold text-slate-800">{fmtDate(data.updated_at)}</dd></div>
          </dl>
          {data.url && (
            <a href={data.url} target="_blank" rel="noreferrer" className="btn-outline mt-4 w-full"><ExternalLink className="h-4 w-4" /> {t("Open project link")}</a>
          )}
          <div className="mt-4 border-t border-slate-100 pt-4">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-800"><Users className="h-4 w-4 text-brand-600" /> {t("Team")}</h3>
              <button className="btn-ghost px-2 py-1 text-xs" onClick={onAddMember}><UserPlus className="h-3.5 w-3.5" /> {t("Add student")}</button>
            </div>
            <ul className="space-y-1.5 text-sm">
              {data.owner && (
                <li className="flex items-center justify-between gap-2">
                  <span className="truncate text-slate-700">{data.owner.full_name}</span>
                  <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-medium text-amber-600"><Crown className="h-3 w-3" /> {t("Owner")}</span>
                </li>
              )}
              {data.members.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-2">
                  <span className="truncate text-slate-700">{m.full_name}</span>
                  {(data.is_owner || m.id === user?.id) && (
                    <button onClick={() => removeMember(m)} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-red-500" aria-label={t("Remove {name}", { name: m.full_name })}><X className="h-3.5 w-3.5" /></button>
                  )}
                </li>
              ))}
              {data.members.length === 0 && <li className="text-xs text-slate-400">{t("Only you so far.")}</li>}
            </ul>
          </div>
          {data.is_owner ? (
            <button className="btn-ghost mt-3 w-full text-red-600" onClick={removeProject}><Trash2 className="h-4 w-4" /> {t("Delete project")}</button>
          ) : (
            user && <button className="btn-ghost mt-3 w-full text-red-600" onClick={() => removeMember({ id: user.id, full_name: user.full_name, student_number: null })}><LogOut className="h-4 w-4 rtl:rotate-180" /> {t("Leave project")}</button>
          )}
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-slate-900">{t("Project files")}</h3>
            <button className="btn-primary" onClick={() => setAdding(Math.max(1, ...(data.files ?? []).map((f) => f.stage)))}><FilePlus2 className="h-4 w-4" /> {t("Add file")}</button>
          </div>
          {data.files?.length === 0 && (
            <Empty title={t("No files yet")} icon={<FilePlus2 className="h-8 w-8 text-slate-400" />}>
              {t("Add a commit log, a deliverable submission or a document link to this project.")}
            </Empty>
          )}
          {data.stages > 1 && !!data.files?.length
            ? Array.from({ length: data.stages }, (_, i) => i + 1).map((n) => {
                const files = (data.files ?? []).filter((f) => Math.min(f.stage, data.stages) === n);
                return (
                  <section key={n} className="space-y-3 pt-2">
                    <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                      <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-50 text-xs text-brand-700">{n}</span>
                        {t("Stage {n}", { n })}
                        <span className="text-xs font-normal text-slate-400">· {files.length === 1 ? t("1 file") : t("{n} files", { n: files.length })}</span>
                      </h4>
                      <button className="btn-ghost px-2 py-1 text-xs" onClick={() => setAdding(n)}><FilePlus2 className="h-3.5 w-3.5" /> {t("Add file")}</button>
                    </div>
                    {files.length === 0 && <div className="rounded-lg border border-dashed border-slate-200 px-4 py-3 text-xs text-slate-400">{t("No files in this stage yet.")}</div>}
                    {files.map((a) => <FileCard key={a.id} a={a} onDelete={() => removeFile(a.id)} />)}
                  </section>
                );
              })
            : data.files?.map((a) => <FileCard key={a.id} a={a} onDelete={() => removeFile(a.id)} />)}
        </div>
      </div>

      <Modal open={adding !== null} title={t("Add a file to {name}", { name: data.name })} onClose={() => setAdding(null)}>
        <FileForm
          key={adding ?? 0}
          projectId={id}
          milestoneId={milestoneId}
          stages={data.stages}
          initialStage={adding ?? 1}
          onAdded={() => {
            setAdding(null);
            reload();
            onChanged();
          }}
        />
      </Modal>
    </div>
  );
}

function ProjectCard({ wp, onOpen }: { wp: WorkProject; onOpen: () => void }) {
  const t = useT();
  return (
    <button onClick={onOpen} className="card group flex flex-col p-5 text-start transition hover:border-brand-300 hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div className="rounded-xl bg-brand-50 p-2.5"><FolderKanban className="h-6 w-6 text-brand-600" /></div>
        <ChevronRight className="h-5 w-5 text-slate-300 transition rtl:rotate-180 group-hover:translate-x-0.5 rtl:group-hover:-translate-x-0.5 group-hover:text-brand-500" />
      </div>
      <div className="mt-4 font-semibold text-slate-900">{wp.name}</div>
      <p className="mt-1 line-clamp-2 min-h-[2.5rem] text-sm text-slate-500">{wp.description || t("No description")}</p>
      <div className="mt-3 flex items-center gap-1.5 text-xs text-slate-500">
        <Users className="h-3.5 w-3.5" />
        {wp.is_owner
          ? wp.members.length === 0 ? t("Only you") : t("You + {n} students", { n: wp.members.length })
          : t("Shared by {name}", { name: wp.owner?.full_name ?? "" })}
      </div>
      <div className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-400">
        {wp.stages === 1 ? t("1 stage") : wp.stages === 2 ? t("2 stages") : t("{n} stages", { n: wp.stages })} ·{" "}
        {wp.file_count === 1
          ? t("1 file · Updated {date}", { date: fmtDate(wp.updated_at) })
          : t("{n} files · Updated {date}", { n: wp.file_count, date: fmtDate(wp.updated_at) })}
      </div>
    </button>
  );
}

export default function MyProjects() {
  const t = useT();
  const { data, loading, error, reload } = useFetch(() => api<WorkProject[]>("/api/student/work-projects"));
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(false);
  // Project pre-selected in the add-student window; null = closed.
  const [addingMember, setAddingMember] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  if (loading && !data) return <Loading />;
  if (error) return <Alert kind="error">{error}</Alert>;
  const projects = data ?? [];

  const open = (id: string | null) => setParams(id ? { project: id } : {});
  const requested = projects.find((p) => p.id === params.get("project"))?.id;
  // With a single project there is nothing to choose: open it straight away.
  const selected = requested ?? (projects.length === 1 ? projects[0].id : null);

  const created = (wp: WorkProject) => {
    setCreating(false);
    reload();
    open(wp.id);
  };

  return (
    <div>
      <PageHeader
        title={t("My Projects")}
        subtitle={t("Your projects and their files. File metadata (commit logs, submission times) is used as objective behavioral evidence; content is never graded.")}
        actions={
          projects.length > 0 && (
            <>
              <button className="btn-outline" onClick={() => setAddingMember(selected ?? "")}><UserPlus className="h-4 w-4" /> {t("Add student")}</button>
              <button className="btn-primary" onClick={() => setCreating(true)}><FolderPlus className="h-4 w-4" /> {t("Add project")}</button>
            </>
          )
        }
      />

      <div className="mb-8">
        <TeamSection />
      </div>

      {projects.length === 0 ? (
        <div className="card mx-auto max-w-xl p-6">
          <h2 className="font-semibold text-slate-900">{t("Add your first project")}</h2>
          <p className="mb-5 mt-1 text-sm text-slate-500">{t("Create a project, then add its commit logs, deliverables and links.")}</p>
          <ProjectForm onCreated={created} />
        </div>
      ) : selected ? (
        <ProjectDetail
          key={selected}
          id={selected}
          version={version}
          onAddMember={() => setAddingMember(selected)}
          onBack={projects.length > 1 ? () => open(null) : undefined}
          onChanged={(deleted) => {
            if (deleted) open(null);
            reload();
          }}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {projects.map((wp) => <ProjectCard key={wp.id} wp={wp} onOpen={() => open(wp.id)} />)}
        </div>
      )}

      <Modal open={creating} title={t("Add project")} onClose={() => setCreating(false)}>
        <ProjectForm onCreated={created} />
      </Modal>

      <Modal open={addingMember !== null} title={t("Add student to a project")} onClose={() => setAddingMember(null)}>
        <AddMemberForm
          key={addingMember ?? ""}
          projects={projects}
          initialProjectId={addingMember ?? ""}
          onDone={(pid) => {
            setAddingMember(null);
            reload();
            setVersion((v) => v + 1);
            open(pid);
          }}
        />
      </Modal>
    </div>
  );
}
