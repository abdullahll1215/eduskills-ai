import { ExternalLink, Plus, Trash2 } from "lucide-react";
import { FormEvent, useState } from "react";
import { api } from "../../api/client";
import type { Competency } from "../../api/types";
import { Alert, Loading, PageHeader, useFetch } from "../../components/ui";

interface ResourceRow {
  id: string;
  competency_id: string;
  skill: string;
  title: string;
  provider: string;
  url: string;
  kind: string;
  duration: string;
}

export default function Rubric() {
  const { data: comps, loading, reload } = useFetch(() => api<Competency[]>("/api/competencies"));
  const { data: resources, reload: reloadRes } = useFetch(() => api<ResourceRow[]>("/api/admin/resources"));
  const [editing, setEditing] = useState<Competency | null>(null);
  const [res, setRes] = useState({ competency_id: "", title: "", provider: "", url: "", kind: "article", duration: "" });
  const [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  if (loading) return <Loading />;

  const saveComp = async (e: FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    try {
      await api(`/api/admin/competencies/${editing.id}`, { method: "PUT", body: { skill_name: editing.skill_name, description: editing.description, rubric: editing.rubric } });
      setEditing(null);
      setMsg({ kind: "success", text: "Rubric updated." });
      reload();
    } catch (err) {
      setMsg({ kind: "error", text: (err as Error).message });
    }
  };

  const addRes = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api("/api/admin/resources", { body: res });
      setRes({ ...res, title: "", url: "", duration: "", provider: "" });
      reloadRes();
    } catch (err) {
      setMsg({ kind: "error", text: (err as Error).message });
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Rubric & Learning Resources" subtitle="Soft-skill taxonomy (WEF-aligned), Likert descriptors and the curated resources repository used for AI recommendations." />
      {msg && <Alert kind={msg.kind} onClose={() => setMsg(null)}>{msg.text}</Alert>}

      <div className="grid gap-4 md:grid-cols-2">
        {comps?.map((c) =>
          editing?.id === c.id ? (
            <form key={c.id} onSubmit={saveComp} className="card space-y-3 p-5 md:col-span-2">
              <div className="grid gap-3 sm:grid-cols-2">
                <div><label className="label">Skill name</label><input className="input" value={editing.skill_name} onChange={(e) => setEditing({ ...editing, skill_name: e.target.value })} /></div>
                <div><label className="label">Description</label><input className="input" value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} /></div>
              </div>
              {["1", "2", "3", "4", "5"].map((lv) => (
                <div key={lv} className="flex items-center gap-3">
                  <span className="w-6 text-center font-bold text-brand-600">{lv}</span>
                  <input className="input" value={editing.rubric[lv] ?? ""} onChange={(e) => setEditing({ ...editing, rubric: { ...editing.rubric, [lv]: e.target.value } })} />
                </div>
              ))}
              <div className="flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={() => setEditing(null)}>Cancel</button><button className="btn-primary">Save rubric</button></div>
            </form>
          ) : (
            <div key={c.id} className="card p-5">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-semibold text-slate-900">{c.skill_name}</h3>
                  <p className="text-xs text-slate-500">{c.description}</p>
                </div>
                <button className="btn-outline px-3 py-1 text-xs" onClick={() => setEditing(c)}>Edit</button>
              </div>
              <ol className="mt-3 space-y-1 text-xs text-slate-600">
                {Object.entries(c.rubric).map(([k, v]) => <li key={k}><b className="text-brand-600">{k}</b> — {v}</li>)}
              </ol>
            </div>
          ),
        )}
      </div>

      <div className="card p-6">
        <h2 className="font-semibold text-slate-900">Learning resources repository</h2>
        <form onSubmit={addRes} className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <select className="input" required value={res.competency_id} onChange={(e) => setRes({ ...res, competency_id: e.target.value })}>
            <option value="">Skill...</option>
            {comps?.map((c) => <option key={c.id} value={c.id}>{c.skill_name}</option>)}
          </select>
          <input className="input lg:col-span-2" required placeholder="Title" value={res.title} onChange={(e) => setRes({ ...res, title: e.target.value })} />
          <input className="input" placeholder="Provider" value={res.provider} onChange={(e) => setRes({ ...res, provider: e.target.value })} />
          <input className="input" required placeholder="https://..." value={res.url} onChange={(e) => setRes({ ...res, url: e.target.value })} />
          <div className="flex gap-2">
            <select className="input" value={res.kind} onChange={(e) => setRes({ ...res, kind: e.target.value })}>
              <option value="article">Article</option><option value="video">Video</option><option value="course">Course</option><option value="exercise">Exercise</option>
            </select>
            <button className="btn-primary px-3"><Plus className="h-4 w-4" /></button>
          </div>
        </form>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-100">
            <thead className="bg-slate-50"><tr><th className="th">Skill</th><th className="th">Title</th><th className="th">Provider</th><th className="th">Type</th><th className="th"></th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {resources?.map((r) => (
                <tr key={r.id}>
                  <td className="td">{r.skill}</td>
                  <td className="td font-medium"><a href={r.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-brand-600">{r.title} <ExternalLink className="h-3 w-3" /></a></td>
                  <td className="td">{r.provider}</td>
                  <td className="td capitalize">{r.kind}</td>
                  <td className="td text-right"><button className="btn-ghost p-1.5 text-red-500" onClick={() => api(`/api/admin/resources/${r.id}`, { method: "DELETE" }).then(reloadRes)}><Trash2 className="h-4 w-4" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
