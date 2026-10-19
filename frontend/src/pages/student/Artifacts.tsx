import { ExternalLink, GitCommitHorizontal, Trash2, Upload } from "lucide-react";
import { FormEvent, useState } from "react";
import { api } from "../../api/client";
import { Alert, Loading, PageHeader, fmtDate, useFetch } from "../../components/ui";
import { useStudentMilestone } from "./shared";

interface ArtifactRow {
  id: string;
  milestone_id: string;
  kind: string;
  title: string;
  url: string | null;
  metrics: Record<string, number | string | boolean | null>;
  created_at: string;
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

export default function Artifacts() {
  const { milestone, loading: l1, error: e1 } = useStudentMilestone();
  const { data, loading, error, reload } = useFetch(
    () => (milestone ? api<ArtifactRow[]>("/api/student/artifacts") : Promise.resolve([])),
    [milestone?.id],
  );
  const [kind, setKind] = useState<"git_log" | "submission" | "link">("git_log");
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [gitLog, setGitLog] = useState("");
  const [submittedAt, setSubmittedAt] = useState("");
  const [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  if (l1 || (loading && !data)) return <Loading />;
  if (e1 || error) return <Alert kind="error">{e1 || error}</Alert>;
  if (!milestone) return <Alert>No evaluation period is available yet.</Alert>;

  const onFile = async (file?: File) => {
    if (file) setGitLog(await file.text());
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api("/api/student/artifacts", {
        body: { milestone_id: milestone.id, kind, title, url: url || null, git_log: kind === "git_log" ? gitLog : null, submitted_at: kind === "submission" && submittedAt ? submittedAt : null },
      });
      setMsg({ kind: "success", text: "Artifact added. Behavioral indicators were extracted from its metadata." });
      setTitle("");
      setUrl("");
      setGitLog("");
      reload();
    } catch (err) {
      setMsg({ kind: "error", text: (err as Error).message });
    }
  };

  const remove = async (id: string) => {
    await api(`/api/student/artifacts/${id}`, { method: "DELETE" });
    reload();
  };

  return (
    <div>
      <PageHeader title="Project Artifacts" subtitle="Optional evidence metadata (commit logs, submission timestamps) used as objective behavioral indicators. Content is never graded." />
      <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
        <form onSubmit={submit} className="card h-fit space-y-4 p-6">
          {msg && <Alert kind={msg.kind} onClose={() => setMsg(null)}>{msg.text}</Alert>}
          <div>
            <label className="label">Artifact type</label>
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
          <button className="btn-primary w-full">Add artifact</button>
        </form>

        <div className="space-y-3">
          {data?.length === 0 && <div className="card p-10 text-center text-sm text-slate-500">No artifacts yet.</div>}
          {data?.map((a) => (
            <div key={a.id} className="card p-5">
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
                  <button onClick={() => remove(a.id)} className="btn-ghost p-2 text-red-500" aria-label="Delete"><Trash2 className="h-4 w-4" /></button>
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
          ))}
        </div>
      </div>
    </div>
  );
}
