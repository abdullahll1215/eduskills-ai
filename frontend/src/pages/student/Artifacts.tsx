import { ArrowLeft, ChevronRight, ExternalLink, FilePlus2, FolderKanban, FolderPlus, GitCommitHorizontal, Trash2, Upload } from "lucide-react";
import { FormEvent, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../../api/client";
import type { StudentProject } from "../../api/types";
import { Alert, Empty, Loading, Modal, PageHeader, askConfirm, fmtDate, useFetch } from "../../components/ui";

interface ArtifactRow {
  id: string;
  milestone_id: string;
  kind: string;
  title: string;
  url: string | null;
  metrics: Record<string, number | string | boolean | null>;
  created_at: string;
}

interface WorkProject {
  id: string;
  name: string;
  description: string | null;
  url: string | null;
  created_at: string;
  updated_at: string;
  file_count: number;
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

/** New files are recorded against the open evaluation period, so indicators use its due date. */
function useCurrentMilestoneId() {
  const { data } = useFetch(() => api<StudentProject[]>("/api/student/projects"));
  const milestones = data?.[0]?.milestones ?? [];
  return (milestones.find((m) => m.status === "active") ?? milestones[milestones.length - 1])?.id ?? null;
}

function ProjectForm({ onCreated }: { onCreated: (wp: WorkProject) => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      onCreated(await api<WorkProject>("/api/student/work-projects", { body: { name, description, url: url.trim() || null } }));
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
        <label className="label">Project name</label>
        <input className="input" required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Graduation project, Mobile app" autoFocus />
      </div>
      <div>
        <label className="label">Description (optional)</label>
        <textarea className="input min-h-[90px]" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What is the project about and what is your role in it?" />
      </div>
      <div>
        <label className="label">Project link (optional)</label>
        <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://github.com/team/repo" />
      </div>
      <button className="btn-primary w-full" disabled={busy}><FolderPlus className="h-4 w-4" /> Add project</button>
    </form>
  );
}

function FileForm({ projectId, milestoneId, onAdded }: { projectId: string; milestoneId: string | null; onAdded: () => void }) {
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
    if (!milestoneId) return setError("You need to join a project team before adding files.");
    try {
      await api("/api/student/artifacts", {
        body: { milestone_id: milestoneId, work_project_id: projectId, kind, title, url: url || null, git_log: kind === "git_log" ? gitLog : null, submitted_at: kind === "submission" && submittedAt ? submittedAt : null },
      });
      onAdded();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      {error && <Alert kind="error" onClose={() => setError(null)}>{error}</Alert>}
      <div>
        <label className="label">File type</label>
        <select className="input" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
          <option value="git_log">Git commit log</option>
          <option value="submission">Deliverable submission</option>
          <option value="link">Link / document</option>
        </select>
      </div>
      <div>
        <label className="label">Title</label>
        <input className="input" required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Backend repository" />
      </div>
      <div>
        <label className="label">URL (optional)</label>
        <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://github.com/team/repo" />
      </div>
      {kind === "git_log" && (
        <div>
          <label className="label">Commit log</label>
          <p className="mb-2 text-xs text-slate-500">
            Run <code className="rounded bg-slate-100 px-1">git log --pretty=format:"%H|%an|%aI|%s" --author="you"</code> and paste the output or upload the file.
          </p>
          <textarea className="input min-h-[120px] font-mono text-xs" value={gitLog} onChange={(e) => setGitLog(e.target.value)} required />
          <label className="btn-outline mt-2 cursor-pointer text-xs">
            <Upload className="h-3.5 w-3.5" /> Upload .txt
            <input type="file" accept=".txt,.log,.csv" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
          </label>
        </div>
      )}
      {kind === "submission" && (
        <div>
          <label className="label">Submitted at</label>
          <input type="datetime-local" className="input" value={submittedAt} onChange={(e) => setSubmittedAt(e.target.value)} />
        </div>
      )}
      <button className="btn-primary w-full"><FilePlus2 className="h-4 w-4" /> Add file</button>
    </form>
  );
}

function FileCard({ a, onDelete }: { a: ArtifactRow; onDelete: () => void }) {
  return (
    <div className="card p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <GitCommitHorizontal className="h-5 w-5 text-brand-600" />
          <div>
            <div className="font-semibold text-slate-800">{a.title}</div>
            <div className="text-xs text-slate-400">{a.kind.replace("_", " ")} · {fmtDate(a.created_at)}</div>
          </div>
        </div>
        <div className="flex gap-1">
          {a.url && <a href={a.url} target="_blank" rel="noreferrer" className="btn-ghost p-2"><ExternalLink className="h-4 w-4" /></a>}
          <button onClick={onDelete} className="btn-ghost p-2 text-red-500" aria-label="Delete"><Trash2 className="h-4 w-4" /></button>
        </div>
      </div>
      {Object.keys(a.metrics).length > 0 && (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {Object.entries(a.metrics)
            .filter(([k]) => METRIC_LABELS[k])
            .map(([k, v]) => (
              <div key={k} className="rounded-lg bg-slate-50 px-3 py-2">
                <div className="text-[11px] text-slate-500">{METRIC_LABELS[k]}</div>
                <div className="text-sm font-semibold text-slate-800">
                  {typeof v === "boolean" ? (v ? "Yes" : "No") : k.includes("ratio") || k === "consistency" ? `${Math.round(Number(v) * 100)}%` : String(v)}
                </div>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

function ProjectDetail({ id, onBack, onChanged }: { id: string; onBack?: () => void; onChanged: (deleted?: boolean) => void }) {
  const { data, loading, error, reload } = useFetch(() => api<WorkProject>(`/api/student/work-projects/${id}`), [id]);
  const milestoneId = useCurrentMilestoneId();
  const [adding, setAdding] = useState(false);

  if (loading && !data) return <Loading />;
  if (error) return <Alert kind="error">{error}</Alert>;
  if (!data) return null;

  const removeFile = async (fileId: string) => {
    if (!(await askConfirm("Delete this file?"))) return;
    await api(`/api/student/artifacts/${fileId}`, { method: "DELETE" });
    reload();
    onChanged();
  };

  const removeProject = async () => {
    if (!(await askConfirm(`Delete "${data.name}" and all of its files?`))) return;
    await api(`/api/student/work-projects/${id}`, { method: "DELETE" });
    onChanged(true);
  };

  return (
    <div className="space-y-6">
      {onBack && (
        <button className="btn-ghost -ml-2 text-sm" onClick={onBack}><ArrowLeft className="h-4 w-4" /> All projects</button>
      )}
      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <div className="card h-fit p-6">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-brand-50 p-2.5"><FolderKanban className="h-6 w-6 text-brand-600" /></div>
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-slate-900">{data.name}</h2>
              <div className="text-xs text-slate-400">Created {fmtDate(data.created_at)}</div>
            </div>
          </div>
          {data.description && <p className="mt-4 whitespace-pre-line text-sm text-slate-600">{data.description}</p>}
          <dl className="mt-4 space-y-2 border-t border-slate-100 pt-4 text-sm">
            <div className="flex justify-between"><dt className="text-slate-500">Files</dt><dd className="font-semibold text-slate-800">{data.file_count}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Last update</dt><dd className="font-semibold text-slate-800">{fmtDate(data.updated_at)}</dd></div>
          </dl>
          {data.url && (
            <a href={data.url} target="_blank" rel="noreferrer" className="btn-outline mt-4 w-full"><ExternalLink className="h-4 w-4" /> Open project link</a>
          )}
          <button className="btn-ghost mt-2 w-full text-red-600" onClick={removeProject}><Trash2 className="h-4 w-4" /> Delete project</button>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-slate-900">Project files</h3>
            <button className="btn-primary" onClick={() => setAdding(true)}><FilePlus2 className="h-4 w-4" /> Add file</button>
          </div>
          {data.files?.length === 0 && (
            <Empty title="No files yet" icon={<FilePlus2 className="h-8 w-8 text-slate-400" />}>
              Add a commit log, a deliverable submission or a document link to this project.
            </Empty>
          )}
          {data.files?.map((a) => <FileCard key={a.id} a={a} onDelete={() => removeFile(a.id)} />)}
        </div>
      </div>

      <Modal open={adding} title={`Add a file to ${data.name}`} onClose={() => setAdding(false)}>
        <FileForm
          projectId={id}
          milestoneId={milestoneId}
          onAdded={() => {
            setAdding(false);
            reload();
            onChanged();
          }}
        />
      </Modal>
    </div>
  );
}

function ProjectCard({ wp, onOpen }: { wp: WorkProject; onOpen: () => void }) {
  return (
    <button onClick={onOpen} className="card group flex flex-col p-5 text-left transition hover:border-brand-300 hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div className="rounded-xl bg-brand-50 p-2.5"><FolderKanban className="h-6 w-6 text-brand-600" /></div>
        <ChevronRight className="h-5 w-5 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-brand-500" />
      </div>
      <div className="mt-4 font-semibold text-slate-900">{wp.name}</div>
      <p className="mt-1 line-clamp-2 min-h-[2.5rem] text-sm text-slate-500">{wp.description || "No description"}</p>
      <div className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-400">
        {wp.file_count} {wp.file_count === 1 ? "file" : "files"} · Updated {fmtDate(wp.updated_at)}
      </div>
    </button>
  );
}

export default function MyProjects() {
  const { data, loading, error, reload } = useFetch(() => api<WorkProject[]>("/api/student/work-projects"));
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(false);

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
        title="My Projects"
        subtitle="Your projects and their files. File metadata (commit logs, submission times) is used as objective behavioral evidence; content is never graded."
        actions={projects.length > 0 && <button className="btn-primary" onClick={() => setCreating(true)}><FolderPlus className="h-4 w-4" /> Add project</button>}
      />

      {projects.length === 0 ? (
        <div className="card mx-auto max-w-xl p-6">
          <h2 className="font-semibold text-slate-900">Add your first project</h2>
          <p className="mb-5 mt-1 text-sm text-slate-500">Create a project, then add its commit logs, deliverables and links.</p>
          <ProjectForm onCreated={created} />
        </div>
      ) : selected ? (
        <ProjectDetail
          key={selected}
          id={selected}
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

      <Modal open={creating} title="Add project" onClose={() => setCreating(false)}>
        <ProjectForm onCreated={created} />
      </Modal>
    </div>
  );
}
