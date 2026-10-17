import { BrainCircuit, Calculator, Loader2, PlugZap } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { api } from "../../api/client";
import { Alert, Loading, PageHeader, useFetch } from "../../components/ui";

type Settings = Record<string, string>;

export default function AdminSettings() {
  const { data, loading, error, setData } = useFetch(() => api<Settings>("/api/admin/settings"));
  const [form, setForm] = useState<Settings>({});
  const [msg, setMsg] = useState<{ kind: "success" | "error" | "warning"; text: string } | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  if (loading) return <Loading />;
  if (error) return <Alert kind="error">{error}</Alert>;

  const set = (k: string, v: string) => setForm({ ...form, [k]: v });

  const save = async (e: FormEvent, keys: string[]) => {
    e.preventDefault();
    try {
      const values = Object.fromEntries(keys.map((k) => [k, form[k] ?? ""]));
      const res = await api<Settings>("/api/admin/settings", { method: "PUT", body: { values } });
      setData(res);
      setMsg({ kind: "success", text: "Configuration applied." });
    } catch (err) {
      setMsg({ kind: "error", text: (err as Error).message });
    }
  };

  const test = async () => {
    setTesting(true);
    try {
      const res = await api<{ ok: boolean; message: string }>("/api/admin/ai/test", { method: "POST" });
      setMsg({ kind: res.ok ? "success" : "warning", text: res.message });
    } finally {
      setTesting(false);
    }
  };

  const wI = Number(form.instructor_weight || 0);
  const wP = Number(form.peer_weight || 0);

  return (
    <div className="space-y-6">
      <PageHeader title="Configuration & AI" subtitle="Scoring model, blind-spot thresholds and Generative AI API parameters (UC-08)." />
      {msg && <Alert kind={msg.kind} onClose={() => setMsg(null)}>{msg.text}</Alert>}

      <form onSubmit={(e) => save(e, ["instructor_weight", "peer_weight", "moderate_threshold", "critical_threshold", "instructor_peer_warning", "min_peer_evaluations", "require_self_before_peer", "retention_days"])} className="card p-6">
        <h2 className="flex items-center gap-2 font-semibold text-slate-900"><Calculator className="h-5 w-5 text-brand-600" /> Weighted scoring & blind-spot model</h2>
        <div className="mt-2 rounded-lg bg-slate-50 p-3 font-mono text-xs text-slate-600">
          External = {wI.toFixed(2)} × Instructor + {wP.toFixed(2)} × PeerAverage &nbsp;·&nbsp; δ = |External − Self| &nbsp;·&nbsp; δ ≤ {form.moderate_threshold} aligned, ≤ {form.critical_threshold} moderate, &gt; {form.critical_threshold} critical
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div><label className="label">Instructor weight</label><input type="number" step="0.05" min="0" max="1" className="input" value={form.instructor_weight ?? ""} onChange={(e) => { set("instructor_weight", e.target.value); setForm((f) => ({ ...f, instructor_weight: e.target.value, peer_weight: (1 - Number(e.target.value)).toFixed(2) })); }} /></div>
          <div><label className="label">Peer weight</label><input type="number" step="0.05" min="0" max="1" className="input" value={form.peer_weight ?? ""} onChange={(e) => set("peer_weight", e.target.value)} /></div>
          <div><label className="label">Moderate gap threshold</label><input type="number" step="0.1" className="input" value={form.moderate_threshold ?? ""} onChange={(e) => set("moderate_threshold", e.target.value)} /></div>
          <div><label className="label">Critical gap threshold</label><input type="number" step="0.1" className="input" value={form.critical_threshold ?? ""} onChange={(e) => set("critical_threshold", e.target.value)} /></div>
          <div><label className="label">Instructor/peer warning</label><input type="number" step="0.1" className="input" value={form.instructor_peer_warning ?? ""} onChange={(e) => set("instructor_peer_warning", e.target.value)} /></div>
          <div><label className="label">Min. peer evaluations</label><input type="number" min="1" className="input" value={form.min_peer_evaluations ?? ""} onChange={(e) => set("min_peer_evaluations", e.target.value)} /></div>
          <div><label className="label">Data retention (days)</label><input type="number" min="30" className="input" value={form.retention_days ?? ""} onChange={(e) => set("retention_days", e.target.value)} /></div>
          <label className="mt-6 flex items-center gap-2 text-sm"><input type="checkbox" checked={form.require_self_before_peer === "true"} onChange={(e) => set("require_self_before_peer", String(e.target.checked))} /> Require self-assessment before peer review</label>
        </div>
        {Math.abs(wI + wP - 1) > 0.001 && <p className="mt-2 text-xs text-red-600">Weights must add up to 1.0</p>}
        <div className="mt-5 flex justify-end"><button className="btn-primary">Apply scoring configuration</button></div>
      </form>

      <form onSubmit={(e) => save(e, ["ai_enabled", "ai_base_url", "ai_model", "ai_api_key"])} className="card p-6">
        <h2 className="flex items-center gap-2 font-semibold text-slate-900"><BrainCircuit className="h-5 w-5 text-brand-600" /> Generative AI API</h2>
        <p className="mt-1 text-sm text-slate-500">
          Any OpenAI-compatible Chat Completions endpoint. Keys are stored encrypted. When no key is configured or the API is unreachable, the platform automatically uses the local fallback template engine.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div><label className="label">API base URL</label><input className="input" value={form.ai_base_url ?? ""} onChange={(e) => set("ai_base_url", e.target.value)} placeholder="https://api.openai.com/v1" /></div>
          <div><label className="label">Model</label><input className="input" value={form.ai_model ?? ""} onChange={(e) => set("ai_model", e.target.value)} placeholder="gpt-4o-mini" /></div>
          <div className="sm:col-span-2"><label className="label">API key</label><input type="password" className="input" value={form.ai_api_key ?? ""} onChange={(e) => set("ai_api_key", e.target.value)} placeholder="sk-..." autoComplete="off" /></div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.ai_enabled === "true"} onChange={(e) => set("ai_enabled", String(e.target.checked))} /> Enable Generative AI narratives</label>
        </div>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          {data?.ai_api_key && (
            <button type="button" className="btn-ghost text-red-600" onClick={async () => { const res = await api<Settings>("/api/admin/settings/clear-api-key", { method: "POST" }); setData(res); }}>
              Remove key
            </button>
          )}
          <button type="button" className="btn-outline" onClick={test} disabled={testing}>
            {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlugZap className="h-4 w-4" />} Test connection
          </button>
          <button className="btn-primary">Save AI settings</button>
        </div>
      </form>
    </div>
  );
}
