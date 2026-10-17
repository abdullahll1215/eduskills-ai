import { Activity, BrainCircuit, Database, HardDrive } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../../api/client";
import { Alert, Loading, PageHeader, StatCard, fmtDate, useFetch } from "../../components/ui";

interface Health {
  status: string;
  uptime_seconds: number;
  database: { ok: boolean; latency_ms: number };
  ai: { configured: boolean; enabled: boolean; model: string; mode: string };
  counts: Record<string, number>;
  last_backup: { created_at: string; verified: boolean; filename: string } | null;
}

interface Usage {
  days: number;
  active_users: number;
  per_day: { date: string; events: number }[];
  per_action: { action: string; count: number }[];
}

function uptime(s: number) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}

export default function AdminHealth() {
  const { data, loading, error } = useFetch(() => api<Health>("/api/admin/health"));
  const { data: usage } = useFetch(() => api<Usage>("/api/admin/usage", { params: { days: "30" } }));
  if (loading) return <Loading />;
  if (error || !data) return <Alert kind="error">{error}</Alert>;

  return (
    <div className="space-y-6">
      <PageHeader title="System Health" subtitle="Operational status, AI engine mode and usage over the last 30 days." />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="API status" value={data.status.toUpperCase()} hint={`Uptime ${uptime(data.uptime_seconds)}`} tone="success" icon={<Activity className="h-5 w-5 text-emerald-500" />} />
        <StatCard label="Database" value={`${data.database.latency_ms} ms`} hint="Query latency" icon={<Database className="h-5 w-5 text-brand-500" />} />
        <StatCard
          label="AI engine"
          value={data.ai.mode === "genai" ? "GenAI" : "Fallback"}
          hint={data.ai.mode === "genai" ? data.ai.model : "Local template engine (no API key)"}
          tone={data.ai.mode === "genai" ? "success" : "warning"}
          icon={<BrainCircuit className="h-5 w-5 text-brand-500" />}
        />
        <StatCard
          label="Last backup"
          value={data.last_backup ? (data.last_backup.verified ? "Verified" : "FAILED") : "None"}
          hint={data.last_backup ? fmtDate(data.last_backup.created_at, true) : "Run one from Backup & Retention"}
          tone={data.last_backup ? (data.last_backup.verified ? "success" : "danger") : "warning"}
          icon={<HardDrive className="h-5 w-5 text-slate-500" />}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {Object.entries(data.counts).map(([k, v]) => (
          <div key={k} className="card p-4">
            <div className="text-xs capitalize text-slate-500">{k.replace(/_/g, " ")}</div>
            <div className="mt-1 text-xl font-bold text-slate-900">{v}</div>
          </div>
        ))}
      </div>
      {usage && (
        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <div className="card p-6">
            <h2 className="font-semibold text-slate-900">Activity (audit events per day)</h2>
            <div className="text-xs text-slate-500">{usage.active_users} distinct users signed in during the last {usage.days} days</div>
            <div className="mt-4 h-64">
              <ResponsiveContainer>
                <AreaChart data={usage.per_day} margin={{ left: -20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Area type="monotone" dataKey="events" stroke="#4f46e5" fill="#c7d2fe" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="card p-6">
            <h2 className="font-semibold text-slate-900">Top actions</h2>
            <ul className="mt-3 space-y-2 text-sm">
              {usage.per_action.slice(0, 10).map((a) => (
                <li key={a.action} className="flex justify-between"><span className="font-mono text-xs text-slate-600">{a.action}</span><span className="font-semibold">{a.count}</span></li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
